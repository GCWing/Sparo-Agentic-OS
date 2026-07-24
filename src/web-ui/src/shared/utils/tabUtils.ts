 

import { i18nService } from '@/infrastructure/i18n';
import { fileTabManager } from '@/shared/services/FileTabManager';
import type { FileTabOptions } from '@/shared/services/FileTabManager';
import { resolveAndFocusOpenTarget } from '@/shared/services/sceneOpenTargetResolver';
import type { OpenSource } from '@/shared/services/sceneOpenTargetResolver';
import { openProjectCanvasItem } from '@/app/components/panels/content-canvas/openCanvasItem';
import type {
  CanvasItemDescriptor,
  PanelContentType,
} from '@/app/components/panels/content-canvas/types';
import { openActiveAuxiliaryItem } from '@/app/auxiliary-surface';
import { openWorkspaceScene } from '@/app/navigation/workspaceNavigation';
import type { RuntimeScope } from '@/shared/types/runtime-scope';
export type TabTargetMode = 'agent' | 'project';

export interface TabCreationOptions {
  type: string;
  title: string;
  data: any;
  metadata?: Record<string, any>;
  duplicateCheckKey?: string;
  replaceExisting?: boolean;
  /** Target canvas: agent (AuxPane), project (FileViewer), git (Git scene diff area) */
  mode?: TabTargetMode;
}

 
export function createTab(options: TabCreationOptions): void {
  const {
    type,
    title,
    data,
    metadata = {},
    duplicateCheckKey,
    replaceExisting = false,
    mode = 'agent' 
  } = options;

  const item: CanvasItemDescriptor = {
    type: type as PanelContentType,
    title,
    data,
    metadata,
    duplicateCheckKey,
    replaceExisting,
  };
  if (mode === 'project') {
    openProjectCanvasItem(item);
  } else {
    openActiveAuxiliaryItem(item);
  }
}

 
export function createFileViewerTab(
  filePath: string, 
  fileName: string, 
  content: string,
  mode: 'agent' | 'project' = 'project'
): void {
  createTab({
    type: 'file-viewer',
    title: fileName,
    data: content,
    metadata: { filePath, fileName },
    duplicateCheckKey: filePath,
    replaceExisting: false,
    mode
  });
}

 
export function createCodeEditorTab(
  filePath: string,
  fileName: string,
  options?: {
    language?: string;
    readOnly?: boolean;
    showLineNumbers?: boolean;
    showMinimap?: boolean;
    theme?: 'vs-dark' | 'vs-light' | 'hc-black';
    jumpToLine?: number;
    jumpToColumn?: number;
  },
  mode: 'agent' | 'project' = 'agent'
): void {
  createTab({
    type: 'code-editor',
    title: fileName,
    data: {
      filePath,
      fileName,
      language: options?.language,
      readOnly: options?.readOnly ?? false,
      showLineNumbers: options?.showLineNumbers ?? true,
      showMinimap: options?.showMinimap ?? true,
      theme: options?.theme ?? 'vs-dark',
      jumpToLine: options?.jumpToLine,
      jumpToColumn: options?.jumpToColumn
    },
    metadata: { filePath, fileName },
    duplicateCheckKey: `code-editor:${filePath}`,
    replaceExisting: true,
    mode
  });
}

export function createDiffEditorTab(
  filePath: string,
  fileName: string,
  originalCode: string,
  modifiedCode: string,
  readOnly: boolean = false,
  mode: TabTargetMode = 'agent',
  repositoryPath?: string,
  revealLine?: number,
  replaceExisting?: boolean,
  options?: {
    titleKind?: 'diff' | 'fix-preview';
    duplicateKeyPrefix?: 'diff' | 'fix-diff';
  }
): void {
  const titleKind = options?.titleKind ?? (repositoryPath ? 'diff' : 'fix-preview');
  const duplicateKeyPrefix = options?.duplicateKeyPrefix ?? (repositoryPath ? 'diff' : 'fix-diff');
  const duplicateKey = repositoryPath
    ? `${duplicateKeyPrefix}:${repositoryPath}:${filePath}`
    : `${duplicateKeyPrefix}:${filePath}`;
  const titleSuffix =
    titleKind === 'diff'
      ? i18nService.getT()('common:tabs.diff')
      : i18nService.getT()('common:tabs.fixPreview');

  createTab({
    type: 'diff-code-editor',
    title: `${fileName} - ${titleSuffix}`,
    data: {
      fileName,
      filePath,
      language: 'typescript',
      originalCode,
      modifiedCode,
      readOnly,
      repositoryPath,
      revealLine,
    },
    metadata: { filePath, repositoryPath, duplicateCheckKey: duplicateKey },
    duplicateCheckKey: duplicateKey,
    replaceExisting: replaceExisting ?? false,
    mode,
  });
}

export function createMarkdownEditorTab(
  title: string,
  initialContent: string,
  filePath?: string,
  workspacePath?: string,
  mode: 'agent' | 'project' = 'agent'
): void {
  const timestamp = Date.now();
  const duplicateKey = filePath || `markdown-editor-${timestamp}`;
  
  createTab({
    type: 'markdown-editor',
    title,
    data: {
      initialContent,
      filePath,
      fileName: title,
      workspacePath,
      readOnly: false
    },
    metadata: {
      duplicateCheckKey: duplicateKey,
      timestamp
    },
    duplicateCheckKey: duplicateKey,
    replaceExisting: false,
    mode
  });
}

 
export function createConfigCenterTab(
  _initialTab: 'models' | 'agents' = 'models',
  _mode: 'agent' | 'project' = 'agent'
): void {
  openWorkspaceScene('settings');
}

export function createTerminalTab(
  sessionId: string,
  sessionName: string,
  mode: 'agent' | 'project' = 'agent'
): void {
  const title = sessionName.length > 20 
    ? `${sessionName.slice(0, 20)}...` 
    : sessionName;

  const detail = {
    type: 'terminal',
    title: `${title}`,
    data: { sessionId, sessionName },
    metadata: {
      isTerminal: true,
      sessionId,
      duplicateCheckKey: `terminal-${sessionId}`,
    },
    duplicateCheckKey: `terminal-${sessionId}`,
    replaceExisting: false,
  };

  createTab({
    ...detail,
    mode,
  });
}

type OpenFileInBestTargetOptions = Omit<FileTabOptions, 'mode'>;
interface OpenFileTargetContext {
  source?: OpenSource;
  scope?: RuntimeScope | null;
}

/**
 * Open a file to the best target:
 * - active scene is session: open in agent AuxPane tabs
 * - otherwise: open in file-viewer scene project tabs
 *
 * This avoids unexpected focus stealing when session is merely opened but
 * not the currently active scene.
 */
export function openFileInBestTarget(
  options: OpenFileInBestTargetOptions,
  context: OpenFileTargetContext = {}
): void {
  const { mode } = resolveAndFocusOpenTarget('file', {
    source: context.source ?? 'default',
    scope: context.scope,
  });

  fileTabManager.openFile({
    ...options,
    mode,
  });
}
