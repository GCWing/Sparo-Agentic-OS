import { api } from './ApiClient';

export type PromptAssetKind = 'agent' | 'mode' | 'snippet' | 'template';
export type PromptAssetScope = 'user' | 'workspace' | 'project';
export type PromptAssetStatus = 'draft' | 'staging' | 'production' | 'archived';
export type PromptValidationSeverity = 'error' | 'warning';
export type PromptTemplateType = 'custom' | 'codeReview' | 'bugFix' | 'featureDesign' | 'refactor' | 'testing' | 'documentation' | 'architecture' | 'general';

export interface PromptDimensions {
  role?: string;
  context?: string;
  goal?: string;
  boundaries?: string;
  rules?: string;
  examples?: string;
}

export interface PromptAssetMetadata {
  schemaVersion: number;
  id: string;
  kind: PromptAssetKind;
  scope: PromptAssetScope;
  name: string;
  description?: string;
  model?: string;
  readonly?: boolean;
  tools: string[];
  status: PromptAssetStatus;
  version?: string;
  tags: string[];
  sourceHistoryEventId?: string;
  sourceSessionId?: string;
  sourceTurnId?: string;
  dimensions?: PromptDimensions;
  templateType: PromptTemplateType;
}

export interface PromptAsset {
  metadata: PromptAssetMetadata;
  body: string;
  relativePath: string;
  absolutePath: string;
  contentHash: string;
}

export interface PromptAssetSummary {
  id: string;
  kind: PromptAssetKind;
  scope: PromptAssetScope;
  name: string;
  description?: string;
  status: PromptAssetStatus;
  version?: string;
  tags: string[];
  sourceHistoryEventId?: string;
  sourceSessionId?: string;
  sourceTurnId?: string;
  relativePath: string;
  contentHash: string;
  templateType: PromptTemplateType;
}

export interface PromptValidationIssue {
  severity: PromptValidationSeverity;
  code: string;
  message: string;
}

export interface PromptValidationReport {
  valid: boolean;
  issues: PromptValidationIssue[];
}

export interface PromptAssetGitStatusEntry {
  path: string;
  status: string;
}

export interface PromptAssetGitStatus {
  isGitRepository: boolean;
  promptRoot: string;
  entries: PromptAssetGitStatusEntry[];
  message?: string;
}

export interface PromptAssetGitCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

export interface PromptAssetGitDiff {
  isGitRepository: boolean;
  relativePath: string;
  diff: string;
  message?: string;
}

export interface SavePromptAssetPayload {
  workspacePath: string;
  metadata: PromptAssetMetadata;
  body: string;
  relativePath?: string;
}

export interface PromotePromptHistoryToAssetPayload {
  workspacePath: string;
  historyEventId: string;
  metadata: PromptAssetMetadata;
  body?: string;
  relativePath?: string;
}

export interface FileChange {
  file: string;
  added: number;
  removed: number;
}

export interface DetailedToolRecord {
  toolId: string;
  toolName: string;
  durationMs: number;
  status: string;
  error?: string;
  /** Primary affected file path. */
  filePath?: string;
  /** Tool-specific context (command, search pattern, subagent type, URL...). */
  context?: string;
  /** Truncated result output (~200 chars). */
  resultSummary?: string;
  /** ISO-8601 timestamp when the tool started executing. */
  startedAt?: string;
  linesAdded?: number;
  linesRemoved?: number;
}

export interface PrecedingPromptEntry {
  id: string;
  /** First line of the prompt text (truncated). */
  summary: string;
  createdAt: string;
  agentType: string;
}

export interface PromptHistoryEvent {
  id: string;
  sessionId: string;
  sessionName?: string;
  turnId?: string;
  createdAt: string;
  updatedAt?: string;
  source: 'chatInput' | 'retry' | 'scheduled' | 'other';
  text: string;
  promptHash: string;
  agentType: string;
  pinned: boolean;
  afterCommitHash?: string;
  /// First line of the commit message for afterCommitHash.
  afterCommitSubject?: string;
  gitBranchAtCreated?: string;
  forkedFromEventId?: string;
  modelId?: string;
  imageContextCount: number;
  supersedes?: string;
  // Response-side fields (populated after turn completion)
  responseStatus?: 'completed' | 'failed' | 'cancelled';
  responseTotalRounds?: number;
  responseTotalTools?: number;
  responseDurationMs?: number;
  responseTotalTokens?: number;
  responseInputTokens?: number;
  responseOutputTokens?: number;
  /// Truncated final AI response text.
  responseSummary?: string;
  /// Failure reason when responseStatus is 'failed'.
  responseError?: string;
  /// JSON array of [{file, added, removed}] representing changed files (snapshot-based).
  responseModifiedFiles?: string;
  responseLinesAdded?: number;
  responseLinesRemoved?: number;
  /// JSON array of DetailedToolRecord entries sorted by startedAt (timeline order).
  responseToolSummary?: string;
  /// JSON array of PrecedingPromptEntry objects with summary text and timestamps.
  precedingPromptEventIds?: string;
}

export interface PromptHistoryQuery {
  sessionId?: string;
  agentType?: string;
  pinned?: boolean;
  query?: string;
  branch?: string;
  promptHash?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
}

export interface PromptHistorySummary {
  total: number;
  events: PromptHistoryEvent[];
}

export interface PromptLineage {
  event: PromptHistoryEvent;
  ancestors: string[];
  descendants: string[];
  siblings: string[];
}

export type PromptCommitLinkSource = 'headMarker' | 'firstCommit' | 'timeWindow';
export type PromptCommitLinkConfidence = 'direct' | 'inferred';

export interface GitHeadSnapshot {
  observedHead?: string;
  observedBranch?: string;
}

export interface GitPromptTraceSummary {
  traceId: string;
  tracePath: string;
  promptCount: number;
  source: PromptCommitLinkSource;
  confidence: PromptCommitLinkConfidence;
}

export interface GitPromptCommit {
  hash: string;
  shortHash: string;
  parentHashes: string[];
  author: string;
  date: string;
  subject: string;
  branch?: string;
  trace?: GitPromptTraceSummary;
  prompts: PromptHistoryEvent[];
}

export const PromptLibraryAPI = {
  async listPromptAssets(workspacePath: string, scope: PromptAssetScope = 'project'): Promise<PromptAssetSummary[]> {
    return api.invoke<PromptAssetSummary[]>('list_prompt_assets', { request: { workspacePath, scope } });
  },
  async getPromptAsset(workspacePath: string, assetId: string, scope: PromptAssetScope = 'project'): Promise<PromptAsset> {
    return api.invoke<PromptAsset>('get_prompt_asset', { request: { workspacePath, assetId, scope } });
  },
  async savePromptAsset(payload: SavePromptAssetPayload): Promise<PromptAsset> {
    return api.invoke<PromptAsset>('save_prompt_asset', { request: payload });
  },
  async validatePromptContent(content: string): Promise<PromptValidationReport> {
    return api.invoke<PromptValidationReport>('validate_prompt_content', { request: { content } });
  },
  async validatePromptAsset(workspacePath: string, assetId: string, scope: PromptAssetScope = 'project'): Promise<PromptValidationReport> {
    return api.invoke<PromptValidationReport>('validate_prompt_asset', { request: { workspacePath, assetId, scope } });
  },
  async getPromptAssetGitStatus(workspacePath: string): Promise<PromptAssetGitStatus> {
    return api.invoke<PromptAssetGitStatus>('get_prompt_asset_git_status', { request: { workspacePath } });
  },
  async getPromptAssetGitDiff(workspacePath: string, relativePath?: string): Promise<PromptAssetGitDiff> {
    return api.invoke<PromptAssetGitDiff>('get_prompt_asset_git_diff', { request: { workspacePath, relativePath } });
  },
  async getPromptAssetGitHistory(workspacePath: string, relativePath?: string, limit?: number): Promise<PromptAssetGitCommit[]> {
    return api.invoke<PromptAssetGitCommit[]>('get_prompt_asset_git_history', { request: { workspacePath, relativePath, limit } });
  },
  async rollbackPromptAsset(workspacePath: string, relativePath: string, commit: string): Promise<void> {
    return api.invoke('rollback_prompt_asset', { request: { workspacePath, relativePath, commit } });
  },
  async listGitPromptCommits(workspacePath: string, branch?: string, limit?: number, offset?: number): Promise<GitPromptCommit[]> {
    return api.invoke<GitPromptCommit[]>('list_git_prompt_commits', { request: { workspacePath, branch, limit, offset } });
  },
  async getPromptGitBranches(workspacePath: string): Promise<string[]> {
    return api.invoke<string[]>('get_prompt_git_branches', { request: { workspacePath } });
  },
  async getPromptGitHeadSnapshot(workspacePath: string): Promise<GitHeadSnapshot> {
    return api.invoke<GitHeadSnapshot>('get_prompt_git_head_snapshot', { request: { workspacePath } });
  },
  async listPromptHistory(params: { workspacePath: string; sessionId?: string; agentType?: string; pinned?: boolean; query?: string; branch?: string; fromDate?: string; toDate?: string; limit?: number }): Promise<PromptHistorySummary> {
    return api.invoke<PromptHistorySummary>('list_prompt_history', { request: params });
  },
  async getPromptLineage(workspacePath: string, eventId: string): Promise<PromptLineage> {
    return api.invoke<PromptLineage>('get_prompt_lineage', { request: { workspacePath, eventId } });
  },
  async togglePromptPin(workspacePath: string, eventId: string, pinned: boolean): Promise<PromptHistoryEvent> {
    return api.invoke<PromptHistoryEvent>('toggle_prompt_pin', { request: { workspacePath, eventId, pinned } });
  },
  async promotePromptHistoryToAsset(payload: PromotePromptHistoryToAssetPayload): Promise<PromptAsset> {
    return api.invoke<PromptAsset>('promote_prompt_history_to_asset', { request: payload });
  },
};