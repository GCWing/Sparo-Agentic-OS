/**
 * Shared types for FlowChatManager modules.
 */

import type { FlowChatStore } from '../../store/FlowChatStore';
import type { EventBatcher } from '../EventBatcher';
import type { processingStatusManager } from '../ProcessingStatusManager';
import type { FlowToolEvent } from '../EventBatcher';

/**
 * Shared context for FlowChatManager modules.
 */
export interface FlowChatContext {
  flowChatStore: FlowChatStore;
  processingManager: typeof processingStatusManager;
  eventBatcher: EventBatcher;
  /** Streaming tool param buffers stored outside render state: toolId -> raw params chunk buffer */
  toolParamBuffers: Map<string, string>;
  /** Heavy partial-param parse timestamps for adaptive throttling: toolId -> last parse time */
  toolParamParseTimestamps: Map<string, number>;
  pendingTurnCompletions: Map<string, {
    turnId: string;
    lastActivityAt: number;
    timer: ReturnType<typeof setTimeout> | null;
    partialRecoveryReason?: string;
  }>;
  /** In-flight historical session hydration: sessionId -> promise */
  pendingHistoryLoads: Map<string, Promise<void>>;
  /** Single-flight backend coordinator readiness: sessionId -> promise. */
  pendingBackendReadiness?: Map<string, { tail: Promise<void> }>;
  /** Content buffers: sessionId -> (roundId -> content) */
  contentBuffers: Map<string, Map<string, string>>;
  /** Active text items: sessionId -> (roundId -> textItemId) */
  activeTextItems: Map<string, Map<string, string>>;
  /** Debounced save timers: key = "sessionId:turnId" */
  saveDebouncers: Map<string, ReturnType<typeof setTimeout>>;
  /** Last save timestamps: key = "sessionId:turnId" */
  lastSaveTimestamps: Map<string, number>;
  /** Last save content hashes: key = "sessionId:turnId" */
  lastSaveHashes: Map<string, string>;
  /** In-flight save tasks: key = "sessionId:turnId" */
  turnSaveInFlight: Map<string, Promise<void>>;
  /** Pending save marks for coalesced serial execution */
  turnSavePending: Set<string>;
  workspaceContextPath: string | null;
}

/**
 * Tool event handling options.
 */
export interface ToolEventOptions {
  /** Parent tool timestamp. */
  parentTimestamp?: number;
}

export interface SubagentTextChunkData {
  sessionId: string;
  turnId: string;
  roundId: string;
  text: string;
  contentType: string;
  isThinkingEnd?: boolean;
}

export interface SubagentToolEventData {
  sessionId: string;
  turnId: string;
  toolEvent: FlowToolEvent;
  subagentParentInfo?: {
    sessionId: string;
    toolCallId: string;
    dialogTurnId: string;
  };
}

export type { SessionConfig, DialogTurn, ModelRound, FlowTextItem, FlowToolItem } from '../../types/flow-chat';
