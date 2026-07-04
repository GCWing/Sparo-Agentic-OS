/**
 * Session persistence types.
 *
 * Used by session lists and persistence metadata in the frontend.
 */

import type { AppScope } from './app-scope';
import type { ProductAppRuntimeContext } from './product-app-runtime';

export type SessionKind = 'normal' | 'btw';
export type PersistedSessionKind = 'standard' | 'subagent';
export type SessionStorageScope = 'workspace' | 'agentic_os';

/**
 * Identifies what triggered a dialog turn.
 * Injected into userMessage.metadata.triggerSource by the backend coordinator.
 */
export type TriggerSource =
  | 'desktop_ui'
  | 'desktop_api'
  | 'agent_session'
  | 'goal'
  | 'work_message'
  | 'scheduled_job'
  | 'bot'
  | 'cli'
  | 'remote_relay';

export type ProductAppRuntimePanelType = 'product-app-runtime';

export interface ProductAppRuntimeTabMetadata {
  id: string;
  type: ProductAppRuntimePanelType;
  title: string;
  route?: string;
  default?: boolean;
  developerOnly?: boolean;
  data?: Record<string, unknown>;
}

export interface ProductAppRuntimeSessionMetadata {
  appId: string;
  appName: string;
  hostSurfaceId: string;
  hostSurfaceName?: string;
  entityId?: string | null;
  profile: 'product-app-runtime' | string;
  version?: string | number;
  sourceRevision?: string;
  interactionTitle?: string;
  scope: AppScope;
  workspacePath?: string | null;
  runtimeContext?: ProductAppRuntimeContext | null;
  chat?: Record<string, unknown>;
  tabs: ProductAppRuntimeTabMetadata[];
}

export type AgentSessionBindingMode =
  | 'create'
  | 'edit'
  | 'inspect'
  | 'debug'
  | 'run'
  | (string & {});

export type AgentSessionBoundSubjectKind =
  | 'product-app'
  | 'component'
  | 'studio-draft'
  | 'artifact'
  | 'file'
  | 'workspace'
  | 'work'
  | (string & {});

export type AppStudioSubject =
  | {
      kind: 'product-app';
      appId: string;
      version?: string;
      packageRoot: string;
    }
  | {
      kind: 'component';
      componentId: string;
      componentKind: string;
      version?: string;
      packageRoot: string;
    }
  | {
      kind: 'studio-draft';
      draftId: string;
      packageRoot: string;
    };

export type AppStudioFactStatus =
  | 'passed'
  | 'warning'
  | 'failed'
  | 'notRun'
  | 'notVerified'
  | 'blocked'
  | 'running'
  | 'ready'
  | 'waiting';

export interface AppStudioFactCheck {
  id: string;
  status: AppStudioFactStatus | (string & {});
  detail?: string;
}

export interface AppStudioBlueprintSummary {
  whatItDoes?: string;
  howIUseIt?: string;
  whatAiDoes?: string;
  whatData?: string;
  howReady?: string;
}

export interface AppStudioPreviewResult {
  id: string;
  kind: 'product-app-preview' | 'agent-chat' | 'sidecar' | 'full-app' | 'embedded' | 'capability' | 'agent-eval' | 'runtime-boundary' | 'runtime-dependencies' | 'permission-review' | 'user-path-rehearsal' | 'release-rehearsal' | (string & {});
  status: AppStudioFactStatus | (string & {});
  source?: 'runtime-fact' | 'runtime-observation' | 'preview-harness' | 'fix-rerun' | 'release-rehearsal' | (string & {});
  harnessMode?: string | null;
  triggerTurnId?: string | null;
  detail?: string | null;
  checks?: AppStudioFactCheck[];
  workId?: string;
  runtimeInstanceId?: string;
  productAppId?: string;
  componentId?: string;
  productAppSurfaceId?: string;
  surfaceId?: string;
  observedAt: number;
  issueCount: number;
  fatalIssueCount: number;
  warningIssueCount: number;
}

export interface AppStudioIssue {
  id: string;
  appId: string;
  productAppId?: string;
  componentId?: string;
  runtimeInstanceId?: string;
  previewResultId?: string;
  severity: 'fatal' | 'warning' | 'noise';
  status?: 'open' | 'acknowledged' | 'stillOpen' | 'regressed' | 'fixed' | (string & {});
  message: string;
  source?: string | null;
  stack?: string | null;
  category?: string | null;
  timestampMs: number;
  origin: 'runtime-event' | 'work-execution-graph' | 'validation' | 'preview' | (string & {});
}

export interface AppStudioRuntimeLog {
  id: string;
  appId: string;
  productAppId?: string;
  componentId?: string;
  runtimeInstanceId?: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  category: string;
  message: string;
  source?: string | null;
  stack?: string | null;
  details?: unknown;
  timestampMs: number;
  origin: 'runtime-event' | 'work-execution-graph' | (string & {});
}

export interface AppStudioComponentGraphSummary {
  primarySurfaceId?: string;
  primarySurfaceMode?: string;
  sourceFileCount?: number;
  componentCount: number;
  agentComponentCount: number;
  components: Array<{
    componentId: string;
    kind: string;
    source?: string;
    role?: string;
    version?: string | null;
  }>;
}

export interface AppStudioAgentSummary {
  backendActionCount: number;
  memoryScopes: string[];
  sessionPolicies: string[];
}

export interface AppStudioDataSummary {
  readsWorkspace: boolean;
  writesWorkspace: boolean;
  usesRuntimeStorage: boolean;
  externalAccess: boolean;
  retentionPolicy?: string | null;
  deletionPolicy?: string | null;
  migrationPolicy?: string | null;
  sharePolicy?: string | null;
  runtimeRunCount: number;
  artifactCount: number;
  lastActivityAt?: number | null;
}

export interface AppStudioEvalSummary {
  status: AppStudioFactStatus | (string & {});
  caseCount: number;
  detail?: string;
}

export interface AppStudioValidationSummary {
  status: AppStudioFactStatus | (string & {});
  failed: number;
  warnings: number;
  checks: AppStudioFactCheck[];
  updatedAt: number;
  source: 'tool' | 'derived' | (string & {});
}

export interface AppStudioVersionSummary {
  currentVersion?: string;
  sourceRevision?: string | null;
  componentLockDigest?: string;
  checkpointCount?: number;
  releaseCount?: number;
  releaseStatus?: AppStudioFactStatus | (string & {});
  latestCheckpoint?: {
    checkpointId: string;
    artifactUri?: string;
    manifestPath?: string;
    packageDigest?: string;
    componentLockDigest?: string;
    createdAt?: number;
    label?: string | null;
    summary?: string | null;
    releaseStatus?: string;
  };
  latestRelease?: {
    releaseId: string;
    artifactUri?: string;
    manifestPath?: string;
    packageDigest?: string;
    componentLockDigest?: string;
    createdAt?: number;
    label?: string | null;
    notes?: string | null;
    privateDataExcluded?: boolean;
  };
  latestPublishedRelease?: {
    releaseId: string;
    artifactUri?: string;
    sourceDir?: string;
    packageDigest?: string;
    componentLockDigest?: string;
    publishedAt?: number;
    label?: string | null;
    notes?: string | null;
  };
}

export interface AppStudioShareSummary {
  visibility: 'privateDraft' | 'privateRelease' | 'catalogSource' | 'workspace' | 'public' | (string & {});
  installLocation?: string;
  privateDataExcluded: boolean;
  releaseArtifactId?: string;
  latestReleaseId?: string;
  catalogStatus?: string;
}

export interface AppStudioFacts {
  subject: AppStudioSubject | null;
  blueprint?: AppStudioBlueprintSummary;
  technicalBlueprint?: Record<string, unknown>;
  previewResults: AppStudioPreviewResult[];
  issues: AppStudioIssue[];
  logs?: AppStudioRuntimeLog[];
  componentGraph?: AppStudioComponentGraphSummary;
  agentSummary?: AppStudioAgentSummary;
  dataSummary?: AppStudioDataSummary;
  evalSummary?: AppStudioEvalSummary;
  validationSummary?: AppStudioValidationSummary;
  versionSummary?: AppStudioVersionSummary;
  shareSummary?: AppStudioShareSummary;
}

export interface AgentSessionBindingMetadata {
  schemaVersion: 1;
  intent: {
    agentType: string;
    mode: AgentSessionBindingMode;
  };
  subject: {
    kind: AgentSessionBoundSubjectKind;
    id: string;
    title: string;
    version?: number | string;
    revision?: string;
    data?: Record<string, unknown>;
  };
  surface?: {
    contentType: string;
    title?: string;
    data?: Record<string, unknown>;
    duplicateKey?: string;
  };
  scope: AppScope;
  workspacePath?: string | null;
  openedFrom?: string;
  updatedAt: number;
}

export interface SessionCustomMetadata extends Record<string, unknown> {
  kind?: SessionKind;
  parentSessionId?: string | null;
  parentRequestId?: string | null;
  parentDialogTurnId?: string | null;
  parentTurnIndex?: number | null;
  forkOrigin?: {
    sessionId?: string | null;
    turnId?: string | null;
    turnIndex?: number | null;
  } | null;
  lastFinishedAt?: number | null;
  agentSessionBinding?: AgentSessionBindingMetadata;
  appStudioFacts?: AppStudioFacts;
  productAppRuntime?: ProductAppRuntimeSessionMetadata;
}

export interface SessionMetadata {
  sessionId: string;
  sessionName: string;
  agentType: string;
  sessionKind?: PersistedSessionKind;
  modelName: string;
  createdAt: number;
  lastActiveAt: number;
  turnCount: number;
  messageCount: number;
  toolCallCount: number;
  status: SessionStatus;
  snapshotSessionId?: string;
  tags: string[];
  customMetadata?: SessionCustomMetadata;
  todos?: any[];
  workspacePath?: string;
  storageScope?: SessionStorageScope;
  /**
   * Unread completion status for the session.
   */
  unreadCompletion?: 'completed' | 'error' | 'interrupted';
  /**
   * High-priority attention status for the session.
   * Takes precedence over unreadCompletion in the UI.
   */
  needsUserAttention?: 'ask_user' | 'tool_confirm';
}

export type SessionStatus = 'active' | 'archived' | 'completed';
export type DialogTurnKind = 'user_dialog' | 'manual_compaction';

export interface SessionList {
  sessions: SessionMetadata[];
  lastUpdated: number;
  version: string;
}

export interface DialogTurnData {
  turnId: string;
  turnIndex: number;
  sessionId: string;
  timestamp: number;
  kind?: DialogTurnKind;
  userMessage: UserMessageData;
  followUpUserMessages?: FollowUpUserMessageData[];
  modelRounds: ModelRoundData[];
  startTime: number;
  endTime?: number;
  durationMs?: number;
  status: TurnStatus;
}

export interface UserMessageData {
  id: string;
  content: string;
  timestamp: number;
  /** Promoted from metadata.triggerSource for type-safe access. */
  triggerSource?: TriggerSource;
  metadata?: Record<string, any>;
}

export interface FollowUpUserMessageData {
  id: string;
  content: string;
  timestamp: number;
  kind: 'guidance';
  status: 'pending' | 'applied' | 'failed';
  guidanceId?: string;
  sourceTurnId?: string;
  appliedAt?: number;
  error?: string;
  hasImages?: boolean;
  imageCount?: number;
  metadata?: Record<string, any>;
}

export interface ModelRoundData {
  id: string;
  turnId: string;
  roundIndex: number;
  timestamp: number;
  textItems: TextItemData[];
  toolItems: ToolItemData[];
  thinkingItems?: ThinkingItemData[];
  startTime: number;
  endTime?: number;
  status: string;
}

export interface TextItemData {
  id: string;
  content: string;
  isStreaming: boolean;
  timestamp: number;
  status?: string;
  orderIndex?: number;
  isMarkdown?: boolean;
}

export interface ThinkingItemData {
  id: string;
  content: string;
  isStreaming: boolean;
  isCollapsed: boolean;
  timestamp: number;
  orderIndex?: number;
  status?: string;
}

export interface ToolItemData {
  id: string;
  toolName: string;
  toolCall: ToolCallData;
  toolResult?: ToolResultData;
  aiIntent?: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  orderIndex?: number;
  status?: string;
  runtime?: Record<string, unknown>;
  interruptionReason?: 'app_restart';
  executionProjection?: Record<string, unknown>;
}

export interface ToolCallData {
  input: any;
  id: string;
}

export interface ToolResultData {
  result: any;
  success: boolean;
  resultForAssistant?: string;
  error?: string;
  durationMs?: number;
}

export type TurnStatus = 'inprogress' | 'completed' | 'error' | 'cancelled';
