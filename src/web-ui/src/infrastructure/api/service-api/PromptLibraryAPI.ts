import { api } from './ApiClient';

export type PromptAssetKind = 'agent' | 'mode' | 'snippet' | 'template';
export type PromptAssetScope = 'user' | 'workspace' | 'project';
export type PromptAssetStatus = 'draft' | 'staging' | 'production' | 'archived';
export type PromptValidationSeverity = 'error' | 'warning';
export type PromptValueTier = 'excellent' | 'high' | 'potential' | 'context' | 'normal' | 'risk';
export type PromptValueConfidence = 'low' | 'medium' | 'high';
export type PromptLlmAssessmentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type PromptValueSignalKind =
  | 'promptCreated'
  | 'turnCompleted'
  | 'turnFailed'
  | 'turnCancelled'
  | 'retry'
  | 'savedAsAsset'
  | 'assetUsed'
  | 'userPinned'
  | 'userFeedback'
  | 'toolSucceeded'
  | 'toolFailed'
  | 'rollback'
  | 'commitWindow'
  | 'structuredPrompt'
  | 'correctionPrompt'
  | 'imageContext';

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

export interface PromptAssetGitStatusEntry { path: string; status: string }
export interface PromptAssetGitStatus { isGitRepository: boolean; promptRoot: string; entries: PromptAssetGitStatusEntry[]; message?: string }
export interface PromptAssetGitCommit { hash: string; shortHash: string; author: string; date: string; subject: string }
export interface PromptAssetGitDiff { isGitRepository: boolean; relativePath: string; diff: string; message?: string }
export type PromptCommitLinkSource = 'headMarker' | 'timeWindow';
export type PromptCommitLinkConfidence = 'direct' | 'inferred';
export interface PromptCommitTraceSummary { traceId: string; tracePath: string; promptCount: number; source: PromptCommitLinkSource; confidence: PromptCommitLinkConfidence }
export interface GitPromptHistoryCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
  trace?: PromptCommitTraceSummary;
  prompts: PromptHistoryEvent[];
}
export interface PromptCommitTracePrompt {
  promptHistoryEventId: string;
  sessionId: string;
  turnId?: string;
  createdAt: string;
  source: string;
  agentType: string;
  model?: string;
  promptHash: string;
  promptSummary: string;
  promptText: string;
}
export interface PromptReviewTrace {
  schemaVersion: number;
  traceId: string;
  commitHash: string;
  shortHash: string;
  commitSubject: string;
  generatedAt: string;
  redacted: boolean;
  prompts: PromptCommitTracePrompt[];
}

export interface PromptValueSignal {
  id: string;
  promptHistoryEventId?: string;
  promptHash?: string;
  sessionId?: string;
  turnId?: string;
  kind: PromptValueSignalKind;
  weight: number;
  confidence: PromptValueConfidence;
  reason: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface PromptValueSignalInput {
  promptHistoryEventId?: string;
  promptHash?: string;
  sessionId?: string;
  turnId?: string;
  kind: PromptValueSignalKind;
  weight?: number;
  confidence?: PromptValueConfidence;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface PromptLlmAssessment {
  promptHistoryEventId: string;
  promptHash: string;
  deterministicScore: number;
  inputHash: string;
  status: PromptLlmAssessmentStatus;
  attempts: number;
  requestedAt: string;
  completedAt?: string;
  model?: string;
  languageCode?: string;
  llmScore?: number;
  confidence?: PromptValueConfidence;
  impactSummary?: string;
  qualityFindings: string[];
  riskFindings: string[];
  recommendedAction?: string;
  suggestedTags: string[];
  templatePotential?: string;
  rationale: string[];
  error?: string;
}

export interface PromptValueRecord {
  promptHistoryEventId: string;
  promptHash: string;
  sessionId: string;
  turnId?: string;
  score: number;
  tier: PromptValueTier;
  confidence: PromptValueConfidence;
  llmAssessment?: PromptLlmAssessment;
  reuseCount: number;
  reasons: string[];
  warnings: string[];
  signals: PromptValueSignal[];
  updatedAt: string;
}

export interface PromptHistorySessionSnapshot {
  sessionName?: string;
  sessionKind?: string;
  workspacePath?: string;
  remoteConnectionId?: string;
  remoteSshHost?: string;
  storageScope?: string;
  modelId?: string;
  maxContextTokens: number;
  autoCompact: boolean;
  enableTools: boolean;
  safeMode: boolean;
  maxTurns: number;
  enableContextCompression: boolean;
  compressionThreshold: number;
}

export interface PromptHistoryModelSnapshot {
  requestedModelId?: string;
  resolvedModelId?: string;
  name?: string;
  provider?: string;
  modelName?: string;
  baseUrl?: string;
  requestUrl?: string;
  enabled?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  category?: string;
  capabilities: string[];
  reasoningMode?: string;
  reasoningEffort?: string;
  thinkingBudgetTokens?: number;
  authType?: string;
  inlineThinkInText?: boolean;
  customHeadersMode?: string;
  hasCustomHeaders: boolean;
  customRequestBodyMode?: string;
  hasCustomRequestBody: boolean;
  skipSslVerify?: boolean;
}

export interface PromptHistoryGlobalAiSnapshot {
  defaultPrimaryModelId?: string;
  defaultFastModelId?: string;
  agentModelId?: string;
  streamIdleTimeoutSecs?: number;
  toolExecutionTimeoutSecs?: number;
  toolConfirmationTimeoutSecs?: number;
  skipToolConfirmation: boolean;
  proxyEnabled: boolean;
  computerUseEnabled: boolean;
  workspaceAutoMemoryEnabled: boolean;
  globalAutoMemoryEnabled: boolean;
}

export interface PromptHistoryRuntimeSnapshot {
  imageContextCount: number;
  persistAgentType?: boolean;
  systemReminderOverridePresent: boolean;
}

export interface PromptHistoryContext {
  triggerSource: string;
  session: PromptHistorySessionSnapshot;
  model?: PromptHistoryModelSnapshot;
  globalAi?: PromptHistoryGlobalAiSnapshot;
  runtime: PromptHistoryRuntimeSnapshot;
}

export interface PromptHistoryEvent {
  id: string;
  sessionId: string;
  turnId?: string;
  workspacePath: string;
  createdAt: string;
  source: 'chatInput' | 'retry' | 'scheduled' | 'other';
  text: string;
  originalText?: string;
  promptHash: string;
  afterCommitHash?: string;
  gitBranchAtCreated?: string;
  agentType: string;
  pinned: boolean;
  context?: PromptHistoryContext;
}

export interface PromptHistorySummary { total: number; events: PromptHistoryEvent[] }
export interface SavePromptAssetPayload { workspacePath: string; metadata: PromptAssetMetadata; body: string; relativePath?: string }
export interface PromotePromptHistoryToAssetPayload { workspacePath: string; sourceWorkspacePath?: string; historyEventId: string; metadata: PromptAssetMetadata; body?: string; relativePath?: string }
export interface RequestPromptLlmAssessmentPayload { workspacePath: string; sourceWorkspacePath?: string; historyEventId: string; modelId?: string; force?: boolean }

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
  async listGitPromptHistory(workspacePath: string, limit?: number): Promise<GitPromptHistoryCommit[]> {
    return api.invoke<GitPromptHistoryCommit[]>('list_git_prompt_history', { request: { workspacePath, limit } });
  },
  async getPromptReviewTrace(workspacePath: string, traceId: string): Promise<PromptReviewTrace> {
    return api.invoke<PromptReviewTrace>('get_prompt_review_trace', { request: { workspacePath, traceId } });
  },
  async listPromptValues(workspacePath: string, scope: PromptAssetScope = 'project', limit?: number): Promise<PromptValueRecord[]> {
    return api.invoke<PromptValueRecord[]>('list_prompt_values', { request: { workspacePath, scope, limit } });
  },
  async recordPromptValueSignal(workspacePath: string, signal: PromptValueSignalInput): Promise<PromptValueSignal> {
    return api.invoke<PromptValueSignal>('record_prompt_value_signal', { request: { workspacePath, ...signal } });
  },
  async requestPromptLlmAssessment(payload: RequestPromptLlmAssessmentPayload): Promise<PromptLlmAssessment> {
    return api.invoke<PromptLlmAssessment>('request_prompt_llm_assessment', { request: payload });
  },
  async listPromptHistory(params: { workspacePath: string; scope?: PromptAssetScope; query?: string; sessionId?: string; limit?: number; agentType?: string; pinned?: boolean }): Promise<PromptHistorySummary> {
    return api.invoke<PromptHistorySummary>('list_prompt_history', { request: params });
  },
  async promotePromptHistoryToAsset(payload: PromotePromptHistoryToAssetPayload): Promise<PromptAsset> {
    return api.invoke<PromptAsset>('promote_prompt_history_to_asset', { request: payload });
  },
};
