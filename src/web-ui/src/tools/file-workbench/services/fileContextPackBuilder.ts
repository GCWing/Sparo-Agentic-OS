import type { FilesContext } from '@/infrastructure/api';
import { getEntryCapabilities } from './fileOpenStrategy';
import { getFileCategory } from './fileClassification';
import {
  filesContextScopeFromFileScope,
  type FileCapability,
  type FileContextPack,
  type FileEntry,
  type FileScope,
  type FileSelectionSummary,
} from '../types';

function fileKindFromEntry(entry: FileEntry): 'file' | 'dir' {
  return entry.kind === 'dir' ? 'dir' : 'file';
}

function isSensitivePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  return /^[a-z]:\/$/.test(normalized)
    || normalized === '/'
    || normalized.includes('/appdata/')
    || normalized.includes('/windows/')
    || normalized.includes('/system32/');
}

export function summarizeSelection(selection: FileEntry[]): FileSelectionSummary {
  const categories = new Map<string, number>();
  const capabilities = new Set<FileCapability>(['askSparo']);
  let fileCount = 0;
  let folderCount = 0;
  let totalSize = 0;

  selection.forEach((entry) => {
    const category = getFileCategory(entry);
    categories.set(category, (categories.get(category) || 0) + 1);
    getEntryCapabilities(entry).forEach((capability) => capabilities.add(capability));
    if (entry.kind === 'dir') {
      folderCount += 1;
    } else {
      fileCount += 1;
      totalSize += entry.size || 0;
    }
  });

  if (selection.length > 0) {
    capabilities.add('addToChat');
  }

  return {
    itemCount: selection.length,
    fileCount,
    folderCount,
    totalSize,
    categories: Array.from(categories.entries())
      .map(([category, count]) => ({ category: category as FileSelectionSummary['categories'][number]['category'], count }))
      .sort((a, b) => b.count - a.count),
    capabilities: Array.from(capabilities),
  };
}

export function buildFileContextPack(params: {
  scope: FileScope;
  cwd: string;
  workspaceRoot?: string;
  selection: FileEntry[];
  recentlyOpenedPaths: string[];
  source?: FileContextPack['source'];
}): FileContextPack {
  const summary = summarizeSelection(params.selection);
  const sensitivePath = isSensitivePath(params.cwd) || params.selection.some((entry) => isSensitivePath(entry.path));
  return {
    id: `file-context-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    scope: params.scope,
    cwd: params.cwd,
    workspaceRoot: params.workspaceRoot,
    selection: params.selection,
    recentlyOpenedPaths: params.recentlyOpenedPaths,
    summary,
    capabilities: summary.capabilities,
    safety: {
      destructiveOperationsRequirePlan: true,
      sensitivePath,
      reason: sensitivePath ? 'Selection includes a sensitive system path.' : undefined,
    },
    source: params.source ?? 'files-scene',
    createdAt: new Date().toISOString(),
  };
}

export function toFilesContext(contextPack: FileContextPack): FilesContext {
  return {
    scope: filesContextScopeFromFileScope(contextPack.scope),
    cwd: contextPack.cwd,
    workspaceRoot: contextPack.workspaceRoot,
    selection: contextPack.selection.map((entry) => ({
      path: entry.path,
      kind: fileKindFromEntry(entry),
      size: entry.size,
      category: getFileCategory(entry),
      readonly: entry.readonly,
      hidden: entry.hidden,
      modified: entry.modified,
    })),
    recentlyOpenedPaths: contextPack.recentlyOpenedPaths,
    summary: contextPack.summary,
    capabilities: contextPack.summary.capabilities,
    source: contextPack.source,
  };
}
