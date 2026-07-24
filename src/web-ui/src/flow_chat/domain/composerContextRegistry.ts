import type { TFunction } from 'i18next';
import {
  BookOpen,
  Braces,
  Clipboard,
  Code2,
  File,
  Folder,
  GitBranch,
  Image,
  Link,
  Layers,
  MousePointer2,
  Sheet,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react';
import { openActiveSessionSidecarPanel } from '@/app/session-profiles';
import { useAgentCanvasStore } from '@/app/components/panels/content-canvas/stores';
import {
  spreadsheetFormulaResultsTrustworthy,
} from '@/app/agentic-os/excel-live/excelLiveFocusStore';
import { systemAPI } from '@/infrastructure/api';
import { i18nService } from '@/infrastructure/i18n';
import type {
  ContextItem,
  ContextType,
  SpreadsheetFocusCacheCoverage,
  SpreadsheetFocusContext,
  SkillSelectionContext,
  TextFragmentContext,
} from '@/shared/types/context';
import type {
  ComposerContextSnapshot,
  ComposerDocument,
} from '@/shared/types/composer';
import { getComposerContextIds } from '@/shared/types/composer';
import { openFileInBestTarget } from '@/shared/utils/tabUtils';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('ComposerContextRegistry');

export type ContextInjectionMode = 'inline' | 'attached' | 'out-of-band';

export interface ContextPresentation {
  label: string;
  detail: string;
  icon: LucideIcon;
  color: 'blue' | 'green' | 'red' | 'yellow' | 'purple' | 'gray';
  canOpen: boolean;
}

export interface OpenContextOptions {
  readOnly: boolean;
  draftKey?: string;
  workspacePath?: string;
  onUpdate?: (contextId: string, updates: Partial<ContextItem>) => void;
}

interface ContextTypeAdapter<T extends ContextItem> {
  injectionMode: ContextInjectionMode;
  presentation: (context: T, t: TFunction<'flow-chat'>) => ContextPresentation;
  serializeForModel: (context: T, capturedAt: number) => string;
  open?: (context: T, options: OpenContextOptions) => void | Promise<void>;
  snapshot?: (context: T) => T;
}

function fileDetail(path: string): string {
  return path;
}

function basePresentation(
  label: string,
  detail: string,
  icon: LucideIcon,
  color: ContextPresentation['color'] = 'gray',
  canOpen = false,
): ContextPresentation {
  return { label, detail, icon, color, canOpen };
}

function textFragmentPreview(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  const characters = Array.from(normalized);
  const preview = characters.slice(0, 14).join('');
  return characters.length > 14 ? `${preview}…` : preview;
}

function formatSpreadsheetCoverage(coverage: SpreadsheetFocusCacheCoverage | undefined): string {
  if (coverage == null) return 'unknown';
  if (typeof coverage === 'number') {
    if (coverage >= 0 && coverage <= 1) return `${Math.round(coverage * 100)}%`;
    return String(coverage);
  }
  const cached = coverage.cachedCellCount ?? coverage.loadedCellCount;
  const selected = coverage.selectedCellCount ?? coverage.totalCellCount;
  if (typeof cached === 'number' && typeof selected === 'number') return `${cached}/${selected} cells`;
  if (typeof coverage.ratio === 'number') return `${Math.round(coverage.ratio * 100)}%`;
  return JSON.stringify(coverage);
}

export function formatSpreadsheetFocusContext(
  context: SpreadsheetFocusContext,
  sendCapturedAt: number,
): string {
  const formulaTrustworthy = spreadsheetFormulaResultsTrustworthy(context);
  const capturedAt = Number.isFinite(context.capturedAt) && context.capturedAt > 0
    ? context.capturedAt
    : sendCapturedAt;
  const lines = [
    `[Spreadsheet Focus (${context.role}): ${context.sheetName}!${context.a1}]`,
    `Binding: session=${context.sessionId || 'unbound'}; workbook=${context.workbookId}${context.workbookPath ? ` (${context.workbookPath})` : ''}`,
    `Selection: ${context.selectionKind}; size=${context.rowCount}x${context.columnCount}`,
    `Mode: ${context.mode || 'unknown'}`,
    `Revision: ${context.revision ?? 'unknown'}`,
    `Cache: ${context.cacheComplete ? 'complete' : 'incomplete'}; coverage=${formatSpreadsheetCoverage(context.cacheCoverage)}`,
    `Formula results: ${formulaTrustworthy ? (context.formulaResultsFresh === true ? 'fresh' : 'no untrusted formula evidence') : 'stale/unknown and untrusted'}; calculationStatus=${JSON.stringify(context.calculationStatus ?? null)}`,
    `Fidelity: ${JSON.stringify(context.fidelity ?? null)}`,
    `Freshness: ${new Date(capturedAt).toISOString()}; age at send ${Math.max(0, sendCapturedAt - capturedAt)} ms`,
  ];
  if (context.valueSummary) {
    lines.push(`${context.cacheComplete ? 'Value summary' : 'Cached value summary (partial, not authoritative)'}: ${JSON.stringify(context.valueSummary)}`);
  }
  if (!formulaTrustworthy) {
    lines.push('Preview TSV: omitted because formula results are stale or not explicitly proven fresh.');
  } else if (context.cacheComplete && context.previewTsv) {
    lines.push(`Preview TSV${context.previewTruncated ? ' (truncated)' : ''}:\n\`\`\`tsv\n${context.previewTsv}\n\`\`\``);
  } else if (!context.cacheComplete) {
    lines.push('Preview TSV: omitted because the selection cache is incomplete.');
  }
  return lines.join('\n');
}

function openTextFragment(context: TextFragmentContext, options: OpenContextOptions): void {
  const longTextTitle = i18nService.t('flow-chat:input.context.longTextTitle', {
    defaultValue: 'Long text',
  });
  const title = options.readOnly
    ? `${longTextTitle} · ${context.charCount.toLocaleString()}`
    : longTextTitle;
  const duplicateCheckKey = options.readOnly
    ? `message-context:${context.id}`
    : `composer-context:${options.draftKey || 'draft'}:${context.id}`;

  openActiveSessionSidecarPanel({
    type: 'markdown-editor',
    title,
    duplicateCheckKey,
    replaceExisting: true,
    data: {
      initialContent: context.content,
      fileName: title,
      workspacePath: options.workspacePath,
      readOnly: options.readOnly,
      onContentChange: options.readOnly || !options.onUpdate
        ? undefined
        : (content: string) => options.onUpdate?.(context.id, {
            content,
            charCount: Array.from(content).length,
          }),
    },
    metadata: {
      contextId: context.id,
      contextType: context.type,
      duplicateCheckKey,
    },
  });
}

const adapters: { [K in ContextType]: ContextTypeAdapter<Extract<ContextItem, { type: K }>> } = {
  'text-fragment': {
    injectionMode: 'inline',
    presentation: (context, t) => basePresentation(
      t('input.context.textFragment', {
        preview: textFragmentPreview(context.content) || t('input.context.emptyPreview', { defaultValue: 'empty' }),
        defaultValue: 'Long text: {{preview}}',
      }),
      t('input.context.characterCount', {
        count: context.charCount,
        defaultValue: '{{count}} chars',
      }),
      Clipboard,
      'purple',
      true,
    ),
    serializeForModel: context => context.content,
    open: openTextFragment,
  },
  'skill-selection': {
    injectionMode: 'inline',
    presentation: (context: SkillSelectionContext, t) => basePresentation(
      context.name,
      context.targetKind === 'suite'
        ? t('input.context.skillSuiteDetail', {
            count: context.memberCount ?? 0,
            defaultValue: 'Skill Suite · {{count}} skills',
          })
        : t('input.context.skillDetail', {
            suite: context.suiteName ?? t('input.context.standaloneSkill', { defaultValue: 'Standalone' }),
            defaultValue: 'Skill · {{suite}}',
          }),
      context.targetKind === 'suite' ? Layers : BookOpen,
      context.targetKind === 'suite' ? 'purple' : 'blue',
    ),
    serializeForModel: context => `Please use the Skill tool with command "${context.command}".`,
  },
  file: {
    injectionMode: 'attached',
    presentation: context => basePresentation(context.fileName, fileDetail(context.filePath), File, 'blue', true),
    serializeForModel: context => `[File: ${context.relativePath || context.filePath}]`,
    open: (context, options) => openFileInBestTarget({
      filePath: context.filePath,
      fileName: context.fileName,
      workspacePath: options.workspacePath,
    }),
  },
  directory: {
    injectionMode: 'attached',
    presentation: context => basePresentation(context.directoryName, context.directoryPath, Folder, 'purple'),
    serializeForModel: context => `[Directory${context.recursive ? ' (recursive)' : ''}: ${context.directoryPath}]`,
  },
  'code-snippet': {
    injectionMode: 'inline',
    presentation: context => basePresentation(
      `${context.fileName}:${context.startLine}-${context.endLine}`,
      context.filePath,
      Code2,
      'green',
      true,
    ),
    serializeForModel: context => [
      `[Code Snippet: ${context.filePath}:${context.startLine}-${context.endLine}]`,
      `\`\`\`${context.language || ''}`,
      context.selectedText,
      '\`\`\`',
    ].join('\n'),
    open: (context, options) => openFileInBestTarget({
      filePath: context.filePath,
      fileName: context.fileName,
      workspacePath: options.workspacePath,
      jumpToRange: { start: context.startLine, end: context.endLine },
    }),
  },
  image: {
    injectionMode: 'out-of-band',
    presentation: context => basePresentation(context.imageName, context.imagePath, Image, 'yellow'),
    serializeForModel: () => '',
    snapshot: context => ({ ...context, dataUrl: undefined, thumbnailUrl: undefined }),
  },
  'terminal-command': {
    injectionMode: 'inline',
    presentation: context => basePresentation(context.command, context.workingDirectory || '', SquareTerminal, 'gray'),
    serializeForModel: context => [
      `[Terminal Command${context.workingDirectory ? ` @ ${context.workingDirectory}` : ''}]`,
      `\`\`\`shell\n${context.command}\n\`\`\``,
      context.output ? `Output:\n\`\`\`text\n${context.output}\n\`\`\`` : '',
    ].filter(Boolean).join('\n'),
  },
  'git-ref': {
    injectionMode: 'attached',
    presentation: context => basePresentation(context.refValue, `Git ${context.refType}`, GitBranch, 'gray'),
    serializeForModel: context => `[Git ${context.refType}: ${context.refValue}${context.commitHash ? ` (${context.commitHash})` : ''}]`,
  },
  url: {
    injectionMode: 'attached',
    presentation: context => basePresentation(context.title || context.url, context.url, Link, 'blue', true),
    serializeForModel: context => `[URL: ${context.url}]`,
    open: async context => {
      try {
        await systemAPI.openExternal(context.url);
      } catch (error) {
        log.error('Failed to open context URL', { url: context.url, error });
      }
    },
  },
  'web-element': {
    injectionMode: 'inline',
    presentation: context => basePresentation(`<${context.tagName}>`, context.path, Braces, 'green'),
    serializeForModel: context => [
      `[Web Element: <${context.tagName}>]`,
      `CSS Path: ${context.path}`,
      context.sourceUrl ? `Source URL: ${context.sourceUrl}` : '',
      context.textContent ? `Text Content: ${context.textContent}` : '',
      context.outerHTML ? `Outer HTML:\n\`\`\`html\n${context.outerHTML}\n\`\`\`` : '',
    ].filter(Boolean).join('\n'),
  },
  'product-app-preview-element-selection': {
    injectionMode: 'inline',
    presentation: context => basePresentation(
      context.element.label || context.element.textContent || context.appName || context.appId,
      `${context.appName || context.appId} · ${context.route}`,
      MousePointer2,
      'green',
    ),
    serializeForModel: context => [
      `[Product App Preview Element: ${context.appName || context.appId} @ ${context.route}]`,
      `Selector: ${context.element.selectorPath}`,
      `Confidence: ${context.confidence}`,
      `Fingerprint: ${JSON.stringify(context.fingerprint)}`,
      `Element Summary:\n\`\`\`json\n${JSON.stringify(context.element, null, 2)}\n\`\`\``,
    ].join('\n'),
  },
  'spreadsheet-focus': {
    injectionMode: 'out-of-band',
    presentation: context => basePresentation(
      `${context.sheetName}!${context.a1}`,
      `${context.mode || 'inspect'} · ${context.cacheComplete ? 'complete cache' : 'partial cache'}`,
      Sheet,
      'green',
    ),
    serializeForModel: formatSpreadsheetFocusContext,
  },
};

export function getContextPresentation(
  context: ContextItem,
  t: TFunction<'flow-chat'>,
): ContextPresentation {
  const adapter = adapters[context.type] as ContextTypeAdapter<ContextItem>;
  return adapter.presentation(context, t);
}

export function getContextInjectionMode(context: ContextItem): ContextInjectionMode {
  return (adapters[context.type] as ContextTypeAdapter<ContextItem>).injectionMode;
}

export function openComposerContext(
  context: ContextItem,
  options: OpenContextOptions,
): void {
  const adapter = adapters[context.type] as ContextTypeAdapter<ContextItem>;
  void adapter.open?.(context, options);
}

export function serializeComposerDocumentForModel(
  document: ComposerDocument,
  contexts: ContextItem[],
  capturedAt = Date.now(),
): string {
  const byId = new Map(contexts.map(context => [context.id, context]));
  return document.nodes.map(node => {
    if (node.type === 'text') return node.text;
    const context = byId.get(node.contextId);
    if (!context) return '';
    return (adapters[context.type] as ContextTypeAdapter<ContextItem>)
      .serializeForModel(context, capturedAt);
  }).join('');
}

export function serializeComposerDocumentForDisplay(
  document: ComposerDocument,
  contexts: ContextItem[],
  t: TFunction<'flow-chat'>,
): string {
  const byId = new Map(contexts.map(context => [context.id, context]));
  return document.nodes.map(node => {
    if (node.type === 'text') return node.text;
    const context = byId.get(node.contextId);
    return context ? `[${getContextPresentation(context, t).label}]` : '';
  }).join('');
}

export function createComposerContextSnapshot(
  document: ComposerDocument,
  contexts: ContextItem[],
): ComposerContextSnapshot {
  const referencedIds = new Set(getComposerContextIds(document));
  const referencedContexts = contexts
    .filter(context => referencedIds.has(context.id) || context.type === 'image')
    .map(context => {
      const adapter = adapters[context.type] as ContextTypeAdapter<ContextItem>;
      return adapter.snapshot ? adapter.snapshot(context) : structuredClone(context);
    });
  return {
    schemaVersion: 1,
    document: structuredClone(document),
    contexts: referencedContexts,
    createdAt: Date.now(),
  };
}

export function freezeComposerDraftContextEditors(
  snapshot: ComposerContextSnapshot,
  draftKey: string,
): void {
  const store = useAgentCanvasStore.getState();
  snapshot.contexts.forEach(context => {
    if (context.type !== 'text-fragment') return;
    const duplicateCheckKey = `composer-context:${draftKey}:${context.id}`;
    if (!store.findTabByMetadata({ duplicateCheckKey })) return;
    openActiveSessionSidecarPanel({
      type: 'markdown-editor',
      title: `${i18nService.t('flow-chat:input.context.longTextTitle', { defaultValue: 'Long text' })} · ${context.charCount.toLocaleString()}`,
      duplicateCheckKey,
      replaceExisting: true,
      data: {
        initialContent: context.content,
        fileName: i18nService.t('flow-chat:input.context.longTextTitle', { defaultValue: 'Long text' }),
        readOnly: true,
      },
      metadata: {
        contextId: context.id,
        contextType: context.type,
        submittedAt: snapshot.createdAt,
        duplicateCheckKey,
      },
    });
  });
}

export function restoreComposerDraftContextEditors(
  snapshot: ComposerContextSnapshot,
  draftKey: string,
  onUpdate: (contextId: string, updates: Partial<ContextItem>) => void,
): void {
  const store = useAgentCanvasStore.getState();
  snapshot.contexts.forEach(context => {
    if (context.type !== 'text-fragment') return;
    const duplicateCheckKey = `composer-context:${draftKey}:${context.id}`;
    if (!store.findTabByMetadata({ duplicateCheckKey })) return;
    const title = i18nService.t('flow-chat:input.context.longTextTitle', { defaultValue: 'Long text' });
    openActiveSessionSidecarPanel({
      type: 'markdown-editor',
      title,
      duplicateCheckKey,
      replaceExisting: true,
      data: {
        initialContent: context.content,
        fileName: title,
        readOnly: false,
        onContentChange: (content: string) => onUpdate(context.id, {
          content,
          charCount: Array.from(content).length,
        }),
      },
      metadata: {
        contextId: context.id,
        contextType: context.type,
        duplicateCheckKey,
      },
    });
  });
}
