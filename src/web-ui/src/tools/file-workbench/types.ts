import type { FilesContextScope, FsEntry, FsEntryKind } from '@/infrastructure/api';

export type FileScope =
  | { kind: 'workspace'; root: string; workspaceId?: string }
  | { kind: 'system'; root?: string; permission: 'auto' | 'prompt' | 'denied' }
  | { kind: 'pinned'; pinId: string; path: string }
  | { kind: 'recent'; id: string };

export type FileCategory = 'text' | 'image' | 'video' | 'audio' | 'archive' | 'document' | 'folder' | 'other';
export type BrowserSortBy = 'name' | 'modified' | 'size' | 'type';
export type SortOrder = 'asc' | 'desc';
export type FileCapability =
  | 'openInSparo'
  | 'openExternal'
  | 'addToChat'
  | 'askSparo'
  | 'openAsWorkspace'
  | 'reveal'
  | 'copyPath'
  | 'preview'
  | 'summarize'
  | 'organize'
  | 'findDuplicates'
  | 'operationPlan';
export type FileOpenActionId = 'openFolder' | 'openInSparo' | 'openExternal';

export interface FileEntryStatus {
  opened?: boolean;
  dirty?: boolean;
  git?: 'modified' | 'added' | 'deleted' | 'renamed' | 'ignored' | 'clean';
  agentModified?: boolean;
  watched?: boolean;
}

export interface FileEntry extends Omit<FsEntry, 'kind'> {
  id: string;
  kind: FsEntryKind;
  scope: FileScope;
  category: FileCategory;
  extension?: string;
  mimeType?: string;
  resolvedPath?: string;
  capabilities: FileCapability[];
  status?: FileEntryStatus;
}

export interface FileSelectionSummary {
  itemCount: number;
  fileCount: number;
  folderCount: number;
  totalSize: number;
  categories: Array<{ category: FileCategory; count: number }>;
  capabilities: FileCapability[];
}

export interface FileSafetyPolicy {
  destructiveOperationsRequirePlan: boolean;
  sensitivePath: boolean;
  reason?: string;
}

export interface FileContextPack {
  id: string;
  scope: FileScope;
  cwd: string;
  workspaceRoot?: string;
  selection: FileEntry[];
  recentlyOpenedPaths: string[];
  summary: FileSelectionSummary;
  capabilities: FileCapability[];
  safety: FileSafetyPolicy;
  source: 'files-scene' | 'chat' | 'editor' | 'tool-card' | 'file-workbench';
  createdAt: string;
}

export interface FileOpenDecision {
  primary: FileOpenActionId;
  secondary: FileOpenActionId[];
  capabilities: FileCapability[];
}

export interface SelectionIntent {
  additive: boolean;
  range: boolean;
}

export function filesContextScopeFromFileScope(scope: FileScope): FilesContextScope {
  if (scope.kind === 'workspace') return 'workspace';
  if (scope.kind === 'pinned') return 'pinned';
  return 'system';
}
