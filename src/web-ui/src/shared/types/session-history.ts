/**
 * Session persistence types.
 *
 * Used by session lists and persistence metadata in the frontend.
 */

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
  | 'work_message'
  | 'scheduled_job'
  | 'bot'
  | 'cli'
  | 'remote_relay';

export type LiveAppWorkbenchPanelType =
  | 'live-app-runner'
  | 'live-app-workbench-tab'
  | 'live-app-diagnostics';

export interface LiveAppWorkbenchTabMetadata {
  id: string;
  type: LiveAppWorkbenchPanelType;
  title: string;
  route?: string;
  default?: boolean;
  developerOnly?: boolean;
  data?: Record<string, unknown>;
}

export interface LiveAppWorkbenchSessionMetadata {
  appId: string;
  appName: string;
  entityId?: string | null;
  profile: 'live-app-workbench' | string;
  version?: number;
  sourceRevision?: string;
  interactionTitle?: string;
  workspacePath?: string | null;
  chat?: Record<string, unknown>;
  tabs: LiveAppWorkbenchTabMetadata[];
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
  liveAppWorkbench?: LiveAppWorkbenchSessionMetadata;
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
