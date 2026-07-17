/**
 * Flow Chat type definitions
 * Supports mixed streaming output.
 */

import type {
  DialogTurnKind,
  SessionCustomMetadata,
  SessionKind,
  SessionStorageScope,
  TriggerSource,
} from '@/shared/types/session-history';
import type { ExecutionNodeActivity, ExecutionNodeStatus, ToolRuntimeState } from '../runtime/statusModel';
import type { SessionDescriptor } from '../domain/sessionDescriptor';

// Base type for streaming items.
export interface FlowItem {
  id: string;
  type: 'text' | 'tool' | 'image-analysis' | 'thinking';
  timestamp: number;
  status: 'pending' | 'preparing' | 'running' | 'streaming' | 'receiving' | 'completed' | 'cancelled' | 'error' | 'analyzing' | 'pending_confirmation' | 'confirmed'; // Includes error, analyzing, and confirmation states.
}

export interface FlowTextItem extends FlowItem {
  type: 'text';
  content: string;
  isStreaming: boolean;
  isMarkdown?: boolean;
  /**
   * Transient runtime status rendered in the current conversation only.
   * It is not persisted as assistant content.
   */
  runtimeStatus?: {
    phase: 'waiting_model' | 'streaming' | 'waiting_tool' | 'running_tool' | 'waiting_permission' | 'saving' | 'recovering';
    scope: 'main' | 'subagent' | 'tool';
    messageKey?: string;
  };
}

export interface FlowThinkingItem extends FlowItem {
  type: 'thinking';
  content: string;
  isStreaming: boolean;
  isCollapsed: boolean; // Whether the thinking block is collapsed.
}

export interface FlowExecutionSummary {
  status: ExecutionNodeStatus;
  activity?: ExecutionNodeActivity;
  latestLabel: string;
  latestDetail?: string;
  latestToolName?: string;
  latestMarkdownLine?: string;
  updatedAt: number;
}

export interface FlowSubagentExecutionProjection {
  id: string;
  kind: 'subagentRun';
  edgeKind: 'delegates';
  parentSessionId: string;
  parentTurnId?: string;
  parentToolId: string;
  childSessionId: string;
  items: AnyFlowItem[];
  summary: FlowExecutionSummary;
  createdAt: number;
  updatedAt: number;
}

export interface FlowToolItem extends FlowItem {
  type: 'tool';
  toolName: string;
  terminalSessionId?: string;
  interruptionReason?: 'app_restart';
  toolCall: {
    input: any;
    id: string;
  };
  toolResult?: {
    result: any;
    success: boolean;
    resultForAssistant?: string;
    error?: string;
    duration_ms?: number;
  };
  requiresConfirmation?: boolean;
  userConfirmed?: boolean;
  runtime?: ToolRuntimeState;
  aiIntent?: string; // AI rationale for calling the tool.
  startTime?: number;  // Tool start time.
  endTime?: number;    // Tool end time.

  _paramsBuffer?: string;  // Internal buffer for accumulated params.
  _streamingFileStats?: {
    additions: number;
    deletions: number;
    filePath?: string;
  };
  /**
   * Durable projection for parent-routed Task/subagent execution.
   * The parent transcript keeps a single Task item; the child execution
   * timeline is restored from this projection instead of a hidden child session.
   */
  executionProjection?: FlowSubagentExecutionProjection;
}

export interface FlowImageAnalysisItem extends FlowItem {
  type: 'image-analysis';
  imageContext: import('@/shared/types/context').ImageContext;
  result?: ImageAnalysisResult | null;
  error?: string;
}

export type AnyFlowItem =
  | FlowTextItem
  | FlowThinkingItem
  | FlowToolItem
  | FlowImageAnalysisItem;

export interface ImageAnalysisResult {
  image_id: string;
  summary: string;              // Short summary.
  detailed_description: string; // Detailed description.
  detected_elements: string[];  // Key detected elements.
  confidence: number;           // Confidence score (0-1).
  analysis_time_ms: number;     // Analysis duration.
}

// Model round: output from a single model call.
export interface ModelRound {
  id: string;
  index: number;
  items: AnyFlowItem[];
  isStreaming: boolean;
  isComplete: boolean;
  status: 'pending' | 'streaming' | 'completed' | 'cancelled' | 'error' | 'pending_confirmation';
  startTime: number;
  endTime?: number;
  error?: string;
}

// Token usage stats.
export interface TokenUsage {
  inputTokens: number;
  outputTokens?: number;
  totalTokens: number;
  timestamp: number;
}

export type ContextSegmentKind =
  | 'system_prompt'
  | 'environment'
  | 'workspace_instructions'
  | 'memory'
  | 'files_context'
  | 'tool_schemas'
  | 'skill_catalog'
  | 'subagent_catalog'
  | 'conversation_history'
  | 'current_user_message'
  | 'assistant_history'
  | 'tool_results'
  | 'images'
  | 'compression_summary'
  | 'provider_overhead';

export interface ContextBudgetSegment {
  id: string;
  kind: ContextSegmentKind;
  label: string;
  tokens: number;
  percent: number;
  source?: {
    type?: string;
    id?: string;
    name?: string;
  };
  properties?: {
    staticPart?: boolean;
    cacheable?: boolean;
    compressible?: boolean;
    userVisible?: boolean;
  };
  children?: ContextBudgetSegment[];
}

export interface ContextBudgetSnapshot {
  id: string;
  kind: 'static' | 'request';
  sessionId: string;
  turnId?: string;
  roundId?: string;
  agentType: string;
  modelId: string;
  provider: string;
  contextWindow: number;
  totals: {
    inputTokens: number;
    reservedOutputTokens: number;
    remainingTokens: number;
    usedRatio: number;
  };
  estimation: {
    algorithm: string;
    confidence: 'high' | 'approx';
    calibrated: boolean;
    calibrationProfileId?: string;
  };
  segments: ContextBudgetSegment[];
  createdAt: number;
}

// Dialog turn: user input + full AI response across model rounds.
export interface DialogTurn {
  id: string;
  sessionId: string; // Used for event filtering.
  kind?: DialogTurnKind;
  userMessage: {
    id: string;
    content: string;
    timestamp: number;
    hasImages?: boolean;
    /** Promoted from metadata.triggerSource. Undefined means desktop_ui (human). */
    triggerSource?: TriggerSource;
    metadata?: Record<string, any>;
    images?: Array<{
      id: string;
      name: string;
      dataUrl?: string;
      imagePath?: string;
      mimeType?: string;
    }>;
  };
  followUpUserMessages?: Array<{
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
    images?: Array<{
      id: string;
      name: string;
      dataUrl?: string;
      imagePath?: string;
      mimeType?: string;
    }>;
  }>;
  
  // Image analysis phase (only when images exist).
  imageAnalysisPhase?: {
    items: FlowImageAnalysisItem[];
    status: 'analyzing' | 'completed' | 'error';
    startTime: number;
    endTime?: number;
  };
  
  enhancedMessage?: string;
  
  modelRounds: ModelRound[];  // Model rounds in chronological order.
  status: 'pending' | 'image_analyzing' | 'processing' | 'finishing' | 'completed' | 'cancelling' | 'cancelled' | 'error'; // Includes image_analyzing.
  startTime: number;
  endTime?: number;
  error?: string;
  tokenUsage?: TokenUsage;
  todos?: TodoItem[];
  backendTurnIndex?: number;
}

export interface FlowChatState {
  sessions: Map<string, Session>;
}

export type SessionLoadPhase =
  | 'metadata-only'
  | 'hydrating'
  | 'hydrated'
  | 'hydrate-failed'
  | 'live';

export interface TodoItem {
  id: string;
  content: string; // Imperative task description.
  status: 'pending' | 'in_progress' | 'completed';
}

// Session state.
export interface Session {
  sessionId: string;
  title?: string;
  titleStatus?: 'generating' | 'generated' | 'failed';
  dialogTurns: DialogTurn[];
  
  // Derived status from deriveSessionStatus():
  // - 'active': sessionId === focusedSessionId
  // - 'error': state machine state === ERROR
  // - 'idle': otherwise
  status: 'active' | 'idle' | 'error';
  
  config: SessionConfig;
  createdAt: number;
  lastActiveAt: number;
  lastFinishedAt?: number;
  updatedAt?: number;
  
  // Persist the last error; real-time errors come from context.errorMessage.
  error: string | null;
  
  /** Authoritative loading phase for the session record and transcript hydration. */
  loadPhase: SessionLoadPhase;
  
  todos?: TodoItem[];
  
  currentTokenUsage?: TokenUsage;
  currentContextBudget?: ContextBudgetSnapshot;
  maxContextTokens?: number;
  
  /** Stable product identity and agent policy for this session. */
  descriptor: SessionDescriptor;

  // Workspace this session belongs to. Used for sidebar display filtering.
  // Sessions are always kept in store for event processing; only display is filtered.
  workspacePath?: string;

  /** Stable backend id — always set for new sessions; do not infer workspace from path alone. */
  workspaceId?: string;

  /** Persistence namespace for this session. Identity comes from descriptor, not storage scope. */
  storageScope?: SessionStorageScope;

  /** Durable app/session-specific metadata kept with the session history record. */
  customMetadata?: SessionCustomMetadata;

  /**
   * Optional parent session id for hierarchical sessions.
   * Used by transient child sessions such as /btw and /scan_host.
   */
  parentSessionId?: string;

  /** Session kind for UI grouping. */
  sessionKind: SessionKind;

  /**
   * Lightweight markers for /btw threads created from this session.
   * Stored only on the parent session for quick navigation.
   */
  btwThreads?: Array<{
    requestId: string;
    childSessionId: string;
    title: string;
    status: 'running' | 'done' | 'error';
    createdAt: number;
    parentDialogTurnId?: string;
    /** 1-based turn index in the parent session when /btw was asked (best-effort). */
    parentTurnIndex?: number;
    error?: string;
  }>;

  /**
   * For /btw child sessions: where this side thread was asked from in the parent session.
   * This is best-effort and may be missing for older sessions.
   */
  btwOrigin?: {
    requestId?: string;
    parentSessionId?: string;
    parentDialogTurnId?: string;
    parentTurnIndex?: number;
  };

  /**
   * Runtime-only session that should stay in memory but never be persisted or
   * shown in primary session navigation.
   */
  isTransient?: boolean;

  /**
   * Set when a session finishes (completed / error / cancelled) while not the active session.
   * Cleared after the user switches to it and the content renders.
   */
  hasUnreadCompletion?: 'completed' | 'error' | 'interrupted';

  /**
   * Set when a session requires user attention while not the active session.
   * This high-priority alert takes precedence over hasUnreadCompletion.
   */
  needsUserAttention?: 'ask_user' | 'tool_confirm';
}

export interface SessionConfig {
  modelName?: string;
  agentType?: string;
  context?: Record<string, string>;
  workspacePath?: string;
  /** Binds session to `WorkspaceInfo.id` (path alone is insufficient for remotes). */
  workspaceId?: string;
  storageScope?: SessionStorageScope;
  /** Optional initial persisted title for product-owned sessions. */
  sessionName?: string;
  /** Optional key used to deduplicate session creation for app-scoped sessions. */
  creationDeduplicationKey?: string;
  /** Metadata persisted with the session, used by profile-owned app panels. */
  customMetadata?: SessionCustomMetadata;
  /** When false, createChatSession skips surface navigation (caller opens the session). */
  navigate?: boolean;
}

export interface QueuedMessage {
  id: string;
  sessionId: string;
  content: string;
  timestamp: number;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  retryCount: number;
  localDialogTurnId?: string;
}

export interface ParsedChunk {
  type: 'text' | 'tool_call' | 'tool_result';
  content: string;
  toolInfo?: {
    tool: string;
    input: any;
    id: string;
  };
  toolResult?: {
    id: string;
    result: any;
    success: boolean;
    error?: string;
  };
}

export interface ToolCardConfig {
  toolName: string;
  displayName: string;
  icon: string;
  requiresConfirmation: boolean;
  resultDisplayType: 'hidden' | 'summary' | 'detailed';
  description?: string;
  displayMode?: 'compact' | 'standard' | 'detailed' | 'terminal';
  primaryColor?: string;
  /**
   * When set, the shell renders the interruption note inside the tool card
   * (e.g. task expanded body) instead of after the card wrapper.
   */
  inlineInterruptionNote?: boolean;
  extensionCard?: AppDefinedToolCardSpec;
}

export interface AppDefinedToolCardSummary {
  preparing?: string;
  running?: string;
  confirming?: string;
  completed?: string;
  failed?: string;
  cancelled?: string;
}

export interface AppDefinedToolCardField {
  label: string;
  path?: string[];
  inputPath?: string[];
  resultPath?: string[];
  format?: 'text' | 'json';
}

export interface AppDefinedToolCardSpec {
  kind?: 'appDefined' | string;
  title?: string;
  displayName?: string;
  icon?: string;
  description?: string;
  summary?: AppDefinedToolCardSummary;
  fields?: AppDefinedToolCardField[];
  template?: 'compact' | 'detail' | 'custom';
  family?: string;
  displayMode?: ToolCardConfig['displayMode'];
  resultDisplayType?: ToolCardConfig['resultDisplayType'];
  primaryColor?: string;
}

export interface ToolCardProps {
  toolItem: FlowToolItem;
  config: ToolCardConfig;
  /** Read-only host policy: content remains interactive, but tool mutations are blocked. */
  mutationsDisabled?: boolean;
  onConfirm?: (updatedInput?: any) => void;  // toolId is known within the card.
  onReject?: () => void;
  onOpenInEditor?: (filePath: string) => void;
  onOpenInPanel?: (panelType: string, data: any) => void;
  onExpand?: () => void;
  sessionId?: string;
  /** Callback for MCP App ui/message requests. Returns whether the message was handled successfully. */
  onMcpAppMessage?: (params: import('@/infrastructure/api/service-api/MCPAPI').McpUiMessageParams) => Promise<import('@/infrastructure/api/service-api/MCPAPI').McpUiMessageResult>;
  /** Interruption / cancellation note; placement depends on tool card config. */
  interruptionNote?: string | null;
}

// Flow Chat callbacks for layered events.
export interface FlowChatCallbacks {
  onDialogTurnStart?: (dialogTurnId: string, userMessage: string) => void;
  onDialogTurnComplete?: (dialogTurnId: string, totalModelRounds: number) => void;
  onModelRoundStart?: (dialogTurnId: string, modelRoundId: string, roundIndex: number) => void;
  onModelRoundContent?: (
    dialogTurnId: string, 
    modelRoundId: string, 
    contentType: 'text' | 'tool_call' | 'tool_result' | 'thinking',
    content: string,
    metadata?: any
  ) => void;
  onModelRoundEnd?: (dialogTurnId: string, modelRoundId: string, status: string) => void;
  onTaskComplete?: (totalDialogTurns: number, result?: any) => void;
  onTaskError?: (error: string, dialogTurnId?: string, modelRoundId?: string) => void;
}

// Flow Chat actions.
export interface FlowChatActions {
  sendMessage: (message: string, sessionId?: string) => Promise<void>;
  createSession: (config?: Partial<SessionConfig>) => Promise<string>;
  switchSession: (sessionId: string) => void;
  confirmTool: (toolId: string, updatedInput?: any) => void;
  rejectTool: (toolId: string) => void;
  clearSession: (sessionId?: string) => void;
  deleteSession: (sessionId: string) => Promise<void>; // Now async.
  retryLastMessage: () => void;
}

// Flow Chat configuration.
export interface FlowChatConfig {
  enableMarkdown: boolean;
  autoScroll: boolean;
  showTimestamps: boolean;
  maxHistoryRounds: number;
  enableVirtualScroll: boolean;
  theme: 'light' | 'dark' | 'auto';
}
