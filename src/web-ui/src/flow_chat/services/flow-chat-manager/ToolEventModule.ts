/**
 * Tool event handling module
 * Handles various tool lifecycle events
 */

import { FlowChatStore } from '../../store/FlowChatStore';
import { normalizePartialJsonBuffer, parsePartialJson } from '../../../shared/utils/partialJsonParser';
import { createLogger } from '@/shared/utils/logger';
import { diffLines } from 'diff';
import type { FlowChatContext, FlowToolItem, ToolEventOptions, DialogTurn } from './types';
import { immediateSaveDialogTurn } from './PersistenceModule';
import { runCompletedToolEffects } from './ToolEffectRegistry';
import { deriveToolRuntimeState, isRuntimeTerminalState, type ToolRuntimeState } from '../../runtime/statusModel';
import { incrementFlowChatCounter, measureFlowChat } from '../../performance/flowChatPerf';
import type {
  CancelledToolEvent,
  CompletedToolEvent,
  ConfirmationNeededToolEvent,
  EarlyDetectedToolEvent,
  FailedToolEvent,
  FlowToolEvent,
  ParamsPartialToolEvent,
  ProgressToolEvent,
  StartedToolEvent,
} from '../EventBatcher';
import { useWorkspaceSurfaceStore, selectFocusedSessionId } from '@/app/navigation/workspaceSurfaceStore';

const log = createLogger('ToolEventModule');
const pendingTerminalSessionIds = new Map<string, string>();
const LARGE_TOOL_PARAM_PARSE_THRESHOLD = 32 * 1024;
const LARGE_TOOL_PARAM_PARSE_INTERVAL_MS = 250;
const STREAMING_DIFF_SYNC_CHAR_LIMIT = 24 * 1024;

interface ToolTerminalReadyEvent {
  tool_use_id: string;
  terminal_session_id: string;
}

/**
 * Unified tool event handler
 * Handles main-session tool events. Subagent tool events are routed through the execution graph.
 */
export function processToolEvent(
  context: FlowChatContext,
  sessionId: string,
  turnId: string,
  toolEvent: FlowToolEvent,
  _options?: ToolEventOptions,
  onTodoWriteResult?: (sessionId: string, turnId: string, result: any) => void
): void {
  const store = FlowChatStore.getInstance();
  const state = store.getState();
  const session = state.sessions.get(sessionId);
  
  if (!session) {
    log.debug('Session not found (processToolEvent)', { sessionId });
    return;
  }

  const dialogTurn = session.dialogTurns.find((turn: DialogTurn) => turn.id === turnId);
  if (!dialogTurn) {
    log.debug('Dialog turn not found (processToolEvent)', { turnId });
    return;
  }

  const existingToolItem = store.findToolItem(sessionId, turnId, toolEvent.tool_id);
  if (
    existingToolItem?.type === 'tool' &&
    isRuntimeTerminalState(deriveToolRuntimeState(existingToolItem as FlowToolItem).lifecycle)
  ) {
    log.debug('Dropping late tool event for terminal tool', {
      sessionId,
      turnId,
      toolId: toolEvent.tool_id,
      eventType: toolEvent.event_type,
    });
    clearBufferedToolParamState(context, toolEvent.tool_id);
    return;
  }

  switch (toolEvent.event_type) {
    case 'EarlyDetected': {
      handleEarlyDetected(context, store, sessionId, turnId, dialogTurn, toolEvent, _options);
      break;
    }
    
    case 'ParamsPartial': {
      handleParamsPartial(context, store, sessionId, turnId, toolEvent);
      break;
    }
    
    case 'Started': {
      flushPendingBatchedEvents(context);
      handleStarted(context, store, sessionId, turnId, dialogTurn, toolEvent, _options);
      break;
    }
    
    case 'Completed': {
      flushPendingBatchedEvents(context);
      handleCompleted(context, store, sessionId, turnId, toolEvent, onTodoWriteResult);
      break;
    }
    
    case 'Failed': {
      flushPendingBatchedEvents(context);
      handleFailed(context, store, sessionId, turnId, toolEvent);
      break;
    }
    
    case 'Cancelled': {
      flushPendingBatchedEvents(context);
      handleCancelled(context, store, sessionId, turnId, toolEvent);
      break;
    }
    
    case 'ConfirmationNeeded': {
      flushPendingBatchedEvents(context);
      handleConfirmationNeeded(store, sessionId, turnId, toolEvent);
      break;
    }
    
    case 'Progress': {
      handleProgress(store, sessionId, turnId, toolEvent);
      break;
    }
    
    default:
      break;
  }
}

function flushPendingBatchedEvents(context: FlowChatContext): void {
  if (context.eventBatcher.getBufferSize() > 0) {
    context.eventBatcher.flushNow();
  }
}

function updateToolItem(
  store: FlowChatStore,
  sessionId: string,
  turnId: string,
  toolId: string,
  updates: Record<string, any>,
  silent = false
): void {
  if (silent) {
    store.updateModelRoundItemSilent(sessionId, turnId, toolId, updates as any);
    return;
  }

  store.updateModelRoundItem(sessionId, turnId, toolId, updates as any);
}

function applyPendingTerminalSessionId(
  store: FlowChatStore,
  sessionId: string,
  turnId: string,
  toolId: string,
  silent = false
): void {
  const terminalSessionId = pendingTerminalSessionIds.get(toolId);
  if (!terminalSessionId) {
    return;
  }

  updateToolItem(store, sessionId, turnId, toolId, {
    terminalSessionId,
  }, silent);
  pendingTerminalSessionIds.delete(toolId);
}

function isTodoWriteSuccessResult(result: unknown): result is Record<string, unknown> {
  return typeof result === 'object' && result !== null && (result as { success?: unknown }).success === true;
}

function isWriteLikeToolName(toolName: string): boolean {
  return ['write', 'write_notebook', 'file_write', 'Write'].includes(toolName);
}

function isEditLikeToolName(toolName: string): boolean {
  return ['edit', 'search_replace', 'Edit'].includes(toolName);
}

function extractPartialJsonStringField(buffer: string | undefined, fieldName: string): string {
  if (!buffer) {
    return '';
  }

  const normalizedBuffer = normalizePartialJsonBuffer(buffer);
  const looseMatch = normalizedBuffer.match(new RegExp(`${fieldName}\\\\?"?\\s*[:{]\\s*\\\\?"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)`, 'i'));
  if (looseMatch?.[1]) {
    return looseMatch[1]
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  const fieldPattern = `"${fieldName}"`;
  const fieldIndex = normalizedBuffer.indexOf(fieldPattern);
  if (fieldIndex < 0) {
    return '';
  }

  const colonIndex = normalizedBuffer.indexOf(':', fieldIndex + fieldPattern.length);
  if (colonIndex < 0) {
    return '';
  }

  let openingQuoteIndex = colonIndex + 1;
  while (openingQuoteIndex < normalizedBuffer.length && /\s/.test(normalizedBuffer[openingQuoteIndex])) {
    openingQuoteIndex += 1;
  }

  if (normalizedBuffer[openingQuoteIndex] !== '"') {
    return '';
  }

  let value = '';
  let escaping = false;

  for (let index = openingQuoteIndex + 1; index < normalizedBuffer.length; index += 1) {
    const char = normalizedBuffer[index];

    if (escaping) {
      if (char === 'n') value += '\n';
      else if (char === 'r') value += '\r';
      else if (char === 't') value += '\t';
      else value += char;
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (char === '"') {
      break;
    }

    value += char;
  }

  return value;
}

function getStreamingParamString(
  parsedParams: Record<string, any>,
  buffer: string,
  fieldNames: string[],
): string {
  for (const fieldName of fieldNames) {
    const value = parsedParams[fieldName];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  for (const fieldName of fieldNames) {
    const value = extractPartialJsonStringField(buffer, fieldName);
    if (value.length > 0) {
      return value;
    }
  }

  return '';
}

function countContentLines(content: string): number {
  if (!content) {
    return 0;
  }

  const lines = content.split(/\r\n|\r|\n/);
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}

function buildStreamingFileStats(
  toolName: string,
  parsedParams: Record<string, any>,
  buffer: string,
): FlowToolItem['_streamingFileStats'] {
  const filePath = getStreamingParamString(parsedParams, buffer, ['file_path', 'target_file', 'path', 'filename']);

  if (isWriteLikeToolName(toolName)) {
    const content = getStreamingParamString(parsedParams, buffer, ['content', 'contents']);
    if (!content && !filePath) {
      return undefined;
    }

    return {
      additions: countContentLines(content),
      deletions: 0,
      filePath: filePath || undefined,
    };
  }

  if (isEditLikeToolName(toolName)) {
    const oldString = getStreamingParamString(parsedParams, buffer, ['old_string']);
    const newString = getStreamingParamString(parsedParams, buffer, ['new_string']);
    if (!oldString && !newString && !filePath) {
      return undefined;
    }

    let additions = 0;
    let deletions = 0;
    if (oldString.length + newString.length > STREAMING_DIFF_SYNC_CHAR_LIMIT) {
      incrementFlowChatCounter('tool.streamingDiff.deferred');
      additions = countContentLines(newString);
      deletions = countContentLines(oldString);
    } else {
      measureFlowChat('tool.streamingDiff.sync', () => {
        for (const change of diffLines(oldString, newString)) {
          const lineCount = change.count ?? 0;
          if (change.added) additions += lineCount;
          else if (change.removed) deletions += lineCount;
        }
      });
    }

    return {
      additions,
      deletions,
      filePath: filePath || undefined,
    };
  }

  return undefined;
}

function clearBufferedToolParamState(context: FlowChatContext, toolId: string): void {
  context.toolParamBuffers.delete(toolId);
  context.toolParamParseTimestamps.delete(toolId);
}

function shouldIgnoreParamsPartial(tool: FlowToolItem): boolean {
  const runtime = deriveToolRuntimeState(tool);
  return (
    runtime.lifecycle === 'running' ||
    runtime.lifecycle === 'waiting_confirmation' ||
    runtime.lifecycle === 'ready' ||
    isRuntimeTerminalState(runtime.lifecycle)
  );
}

function withToolRuntime(tool: FlowToolItem, runtime: Partial<ToolRuntimeState>): FlowToolItem['runtime'] {
  const current = deriveToolRuntimeState(tool);
  return {
    ...current,
    ...runtime,
  };
}

function applyParamsPartial(
  context: FlowChatContext,
  store: FlowChatStore,
  sessionId: string,
  turnId: string,
  toolEvent: ParamsPartialToolEvent,
  silent = false
): void {
  const existingItem = store.findToolItem(sessionId, turnId, toolEvent.tool_id);
  
  if (existingItem && existingItem.type === 'tool') {
    const existingToolItem = existingItem as FlowToolItem;
    if (shouldIgnoreParamsPartial(existingToolItem)) {
      return;
    }

    const prevBuffer = context.toolParamBuffers.get(toolEvent.tool_id) || '';
    const newBuffer = prevBuffer + (toolEvent.params || '');
    context.toolParamBuffers.set(toolEvent.tool_id, newBuffer);

    const isWriteTool = isWriteLikeToolName(toolEvent.tool_name);
    const isEditTool = isEditLikeToolName(toolEvent.tool_name);
    const shouldThrottleHeavyParse =
      (isWriteTool || isEditTool) &&
      newBuffer.length >= LARGE_TOOL_PARAM_PARSE_THRESHOLD;
    const lastParsedAt = context.toolParamParseTimestamps.get(toolEvent.tool_id) || 0;
    const now = Date.now();
    const shouldParseNow =
      !shouldThrottleHeavyParse ||
      deriveToolRuntimeState(existingToolItem).partialInput == null ||
      (now - lastParsedAt) >= LARGE_TOOL_PARAM_PARSE_INTERVAL_MS;

    let parsedParams: Record<string, any> =
      (deriveToolRuntimeState(existingToolItem).partialInput as Record<string, any> | undefined) || {};
    try {
      if (shouldParseNow) {
        parsedParams = parsePartialJson(newBuffer);
        context.toolParamParseTimestamps.set(toolEvent.tool_id, now);
      }
    } catch {
    }

    const streamingFileStats = buildStreamingFileStats(toolEvent.tool_name, parsedParams, newBuffer);
    const contentValue = getStreamingParamString(parsedParams, newBuffer, ['content', 'contents']);
    const newStringValue = getStreamingParamString(parsedParams, newBuffer, ['new_string']);
    const hasContentField = contentValue.length > 0;
    const hasNewString = newStringValue.length > 0;

    let status: 'streaming' | 'receiving' = 'streaming';
    if ((isWriteTool && hasContentField) || (isEditTool && hasNewString)) {
      status = 'receiving';
    }

    updateToolItem(store, sessionId, turnId, toolEvent.tool_id, {
      toolCall: {
        input: parsedParams,
        id: toolEvent.tool_id
      },
      runtime: withToolRuntime(existingToolItem, {
        lifecycle: 'preparing',
        inputPhase: 'streaming',
        input: existingToolItem.toolCall?.input,
        partialInput: parsedParams,
      }),
      status,
      _paramsBuffer: newBuffer,
      _streamingFileStats: streamingFileStats,
      _contentSize: hasContentField ? contentValue.length : undefined
    }, silent);
    applyPendingTerminalSessionId(store, sessionId, turnId, toolEvent.tool_id, silent);
  }
}

function applyProgress(
  store: FlowChatStore,
  sessionId: string,
  turnId: string,
  toolEvent: ProgressToolEvent,
  silent = false
): void {
  const existingItem = store.findToolItem(sessionId, turnId, toolEvent.tool_id);
  
  if (existingItem) {
    updateToolItem(store, sessionId, turnId, toolEvent.tool_id, {
      _progressMessage: toolEvent.message,
      _progressPercentage: toolEvent.percentage
    }, silent);
  }
}

export function processToolParamsPartialInternal(
  context: FlowChatContext,
  sessionId: string,
  turnId: string,
  toolEvent: ParamsPartialToolEvent
): void {
  applyParamsPartial(context, FlowChatStore.getInstance(), sessionId, turnId, toolEvent, true);
}

export function processToolProgressInternal(
  sessionId: string,
  turnId: string,
  toolEvent: ProgressToolEvent
): void {
  applyProgress(FlowChatStore.getInstance(), sessionId, turnId, toolEvent, true);
}

/**
 * Handle tool early detection event
 */
function handleEarlyDetected(
  context: FlowChatContext,
  store: FlowChatStore,
  sessionId: string,
  turnId: string,
  dialogTurn: DialogTurn,
  toolEvent: EarlyDetectedToolEvent,
  options?: ToolEventOptions
): void {
  flushPendingBatchedEvents(context);
  
  const preparingToolItem: FlowToolItem = {
    id: toolEvent.tool_id,
    type: 'tool',
    toolName: toolEvent.tool_name,
    toolCall: {
      input: {},
      id: toolEvent.tool_id
    },
    timestamp: options?.parentTimestamp ? options.parentTimestamp + 2 : Date.now(),
    status: 'preparing',
    runtime: {
      lifecycle: 'preparing',
      inputPhase: 'streaming',
      confirmation: 'none',
      input: {},
      partialInput: {},
      startedAt: options?.parentTimestamp ? options.parentTimestamp + 2 : Date.now(),
    },
    requiresConfirmation: false,
    startTime: options?.parentTimestamp ? options.parentTimestamp + 2 : Date.now(),
  };
  
  let lastModelRound = dialogTurn.modelRounds[dialogTurn.modelRounds.length - 1];
  if (!lastModelRound) {
    const newRoundId = `round_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    lastModelRound = {
      id: newRoundId,
      index: 0,
      items: [],
      isStreaming: true,
      isComplete: false,
      status: 'streaming',
      startTime: Date.now()
    };
    store.addModelRound(sessionId, turnId, lastModelRound);
  }

  store.addModelRoundItem(sessionId, turnId, preparingToolItem, lastModelRound.id);
}

/**
 * Handle tool params partial update event
 */
function handleParamsPartial(
  context: FlowChatContext,
  store: FlowChatStore,
  sessionId: string,
  turnId: string,
  toolEvent: ParamsPartialToolEvent
): void {
  applyParamsPartial(context, store, sessionId, turnId, toolEvent);
}

/**
 * Handle tool started event
 */
function handleStarted(
  context: FlowChatContext,
  store: FlowChatStore,
  sessionId: string,
  turnId: string,
  dialogTurn: DialogTurn,
  toolEvent: StartedToolEvent,
  options?: ToolEventOptions
): void {
  const existingItem = store.findToolItem(sessionId, turnId, toolEvent.tool_id);
  
  if (existingItem) {
    store.updateModelRoundItem(sessionId, turnId, toolEvent.tool_id, {
      // Early events may omit tool_name; Started carries the canonical name — keep card registry in sync.
      toolName: toolEvent.tool_name,
      toolCall: {
        input: toolEvent.params,
        id: toolEvent.tool_id
      },
      runtime: withToolRuntime(existingItem as FlowToolItem, {
        lifecycle: 'running',
        inputPhase: 'parsed',
        input: toolEvent.params,
        partialInput: undefined,
        startedAt: (existingItem as FlowToolItem).startTime ?? Date.now(),
      }),
      status: 'running',
    } as any);
    applyPendingTerminalSessionId(store, sessionId, turnId, toolEvent.tool_id);
    clearBufferedToolParamState(context, toolEvent.tool_id);
  } else {
    const toolItem: FlowToolItem = {
      id: toolEvent.tool_id,
      type: 'tool',
      toolName: toolEvent.tool_name,
      terminalSessionId: pendingTerminalSessionIds.get(toolEvent.tool_id),
      toolCall: {
        input: toolEvent.params,
        id: toolEvent.tool_id
      },
      timestamp: options?.parentTimestamp ? options.parentTimestamp + 2 : Date.now(),
      status: 'running',
      runtime: {
        lifecycle: 'running',
        inputPhase: 'parsed',
        confirmation: 'none',
        input: toolEvent.params,
        startedAt: options?.parentTimestamp ? options.parentTimestamp + 2 : Date.now(),
      },
      requiresConfirmation: false,
      startTime: options?.parentTimestamp ? options.parentTimestamp + 2 : Date.now(),
    };
    
    const lastModelRound = dialogTurn.modelRounds[dialogTurn.modelRounds.length - 1];
    if (lastModelRound) {
      store.addModelRoundItem(sessionId, turnId, toolItem, lastModelRound.id);
      pendingTerminalSessionIds.delete(toolEvent.tool_id);
      clearBufferedToolParamState(context, toolEvent.tool_id);
    } else {
      log.error('Tool Started event without ModelRound (backend bug)', {
        sessionId,
        turnId,
        toolId: toolEvent.tool_id,
        toolName: toolEvent.tool_name
      });
    }
  }
}

/**
 * Handle tool execution completed event
 */
function handleCompleted(
  context: FlowChatContext,
  store: FlowChatStore,
  sessionId: string,
  turnId: string,
  toolEvent: CompletedToolEvent,
  onTodoWriteResult?: (sessionId: string, turnId: string, result: any) => void
): void {
  if (toolEvent.tool_name === 'TodoWrite' && isTodoWriteSuccessResult(toolEvent.result)) {
    onTodoWriteResult?.(sessionId, turnId, toolEvent.result);
  }
  
  const existingToolItem = store.findToolItem(sessionId, turnId, toolEvent.tool_id) as FlowToolItem | null;
  const updates = {
    toolName: toolEvent.tool_name,
    toolResult: {
      result: toolEvent.result,
      success: true,
      resultForAssistant: toolEvent.result_for_assistant,
      duration_ms: toolEvent.duration_ms
    },
    status: 'completed' as const,
    runtime: existingToolItem?.type === 'tool' ? withToolRuntime(existingToolItem, {
      lifecycle: 'completed',
      inputPhase: 'parsed',
      confirmation: deriveToolRuntimeState(existingToolItem).confirmation,
      input: deriveToolRuntimeState(existingToolItem).input,
      partialInput: undefined,
      result: toolEvent.result,
      endedAt: Date.now(),
    }) : undefined,
    endTime: Date.now()
  };

  store.updateModelRoundItem(sessionId, turnId, toolEvent.tool_id, updates as any);
  store.clearSessionNeedsAttention(sessionId);
  runCompletedToolEffects({
    sessionId,
    turnId,
    toolId: toolEvent.tool_id,
    toolName: toolEvent.tool_name,
    result: toolEvent.result,
  });
  clearBufferedToolParamState(context, toolEvent.tool_id);
  
  immediateSaveDialogTurn(context, sessionId, turnId);
}

/**
 * Handle tool execution failed event
 */
function handleFailed(
  context: FlowChatContext,
  store: FlowChatStore,
  sessionId: string,
  turnId: string,
  toolEvent: FailedToolEvent
): void {
  const existingToolItem = store.findToolItem(sessionId, turnId, toolEvent.tool_id) as FlowToolItem | null;
  store.updateModelRoundItem(sessionId, turnId, toolEvent.tool_id, {
    toolName: toolEvent.tool_name,
    toolResult: {
      result: null,
      success: false,
      error: toolEvent.error
    },
    status: 'error',
    runtime: existingToolItem?.type === 'tool' ? withToolRuntime(existingToolItem, {
      lifecycle: 'error',
      inputPhase: 'parsed',
      confirmation: deriveToolRuntimeState(existingToolItem).confirmation,
      input: deriveToolRuntimeState(existingToolItem).input,
      partialInput: undefined,
      result: null,
      error: toolEvent.error,
      endedAt: Date.now(),
    }) : undefined,
    endTime: Date.now()
  } as any);
  store.clearSessionNeedsAttention(sessionId);
  clearBufferedToolParamState(context, toolEvent.tool_id);
  
  immediateSaveDialogTurn(context, sessionId, turnId);
}

/**
 * Handle tool cancelled event
 */
function handleCancelled(
  context: FlowChatContext,
  store: FlowChatStore,
  sessionId: string,
  turnId: string,
  toolEvent: CancelledToolEvent
): void {
  const existingToolItem = store.findToolItem(sessionId, turnId, toolEvent.tool_id);
  const runtime = existingToolItem?.type === 'tool'
    ? deriveToolRuntimeState(existingToolItem as FlowToolItem)
    : null;
  const finalStatus = runtime?.lifecycle === 'completed' ? 'completed' : 'cancelled';
  
  store.updateModelRoundItem(sessionId, turnId, toolEvent.tool_id, {
    toolResult: {
      result: null,
      success: false,
      error: toolEvent.reason || 'User cancelled operation'
    },
    status: finalStatus,
    runtime: {
      lifecycle: finalStatus === 'completed' ? 'completed' : 'cancelled',
      inputPhase: runtime?.inputPhase === 'streaming' ? 'parsed' : runtime?.inputPhase ?? 'none',
      confirmation: runtime?.confirmation ?? 'none',
      input: runtime?.input,
      partialInput: undefined,
      result: null,
      error: toolEvent.reason || 'User cancelled operation',
      endedAt: Date.now(),
    } satisfies Partial<ToolRuntimeState>,
    endTime: Date.now()
  } as any);
  store.clearSessionNeedsAttention(sessionId);
  clearBufferedToolParamState(context, toolEvent.tool_id);
  
  immediateSaveDialogTurn(context, sessionId, turnId);
}

/**
 * Handle tool confirmation needed event
 */
function handleConfirmationNeeded(
  store: FlowChatStore,
  sessionId: string,
  turnId: string,
  toolEvent: ConfirmationNeededToolEvent
): void {
  const existingItem = store.findToolItem(sessionId, turnId, toolEvent.tool_id) as FlowToolItem | null;
  const existingInput =
    existingItem?.type === 'tool' && existingItem.toolCall?.input && typeof existingItem.toolCall.input === 'object'
      ? existingItem.toolCall.input
      : {};
  const confirmationParams =
    toolEvent.params && typeof toolEvent.params === 'object'
      ? toolEvent.params
      : {};

  store.updateModelRoundItem(sessionId, turnId, toolEvent.tool_id, {
    requiresConfirmation: true,
    status: 'pending_confirmation',
    runtime: {
      lifecycle: 'waiting_confirmation',
      inputPhase: 'parsed',
      confirmation: 'required',
      input: {
        ...existingInput,
        ...confirmationParams,
      },
      partialInput: undefined,
    } satisfies Partial<ToolRuntimeState>,
    toolCall: {
      input: {
        ...existingInput,
        ...confirmationParams,
      },
      id: toolEvent.tool_id,
    },
  } as any);

  const focusedSessionId = selectFocusedSessionId(useWorkspaceSurfaceStore.getState());
  if (sessionId !== focusedSessionId) {
    const attentionKind = toolEvent.tool_name === 'AskUserQuestion' ? 'ask_user' : 'tool_confirm';
    store.setSessionNeedsAttention(sessionId, attentionKind);
  }
}

/**
 * Handle tool execution progress event
 */
function handleProgress(
  store: FlowChatStore,
  sessionId: string,
  turnId: string,
  toolEvent: ProgressToolEvent
): void {
  applyProgress(store, sessionId, turnId, toolEvent);
}

/**
 * Handle backend independent tool execution progress event
 */
export function handleToolExecutionProgress(
  event: any
): void {
  const eventData = (event as any).value || event;
  const { tool_use_id, progress_message, percentage } = eventData;

  const store = FlowChatStore.getInstance();
  const location = store.findToolItemLocation(tool_use_id);

  if (!location) {
    log.debug('Tool item not found', { tool_use_id });
    return;
  }

  const toolItem = location.item;
  const existingLogs: string[] = Array.isArray((toolItem as any)._progressLogs)
    ? (toolItem as any)._progressLogs
    : [];
  const lastLog = existingLogs.length > 0 ? existingLogs[existingLogs.length - 1] : undefined;
  const shouldAppend =
    typeof progress_message === 'string' &&
    progress_message.trim().length > 0 &&
    progress_message !== lastLog;
  const nextLogs = shouldAppend ? [...existingLogs, progress_message].slice(-200) : existingLogs;

  store.updateModelRoundItem(location.sessionId, location.dialogTurnId, tool_use_id, {
    _progressMessage: progress_message,
    _progressPercentage: percentage,
    _progressLogs: nextLogs
  } as any);
}

export function handleToolTerminalReady(
  event: ToolTerminalReadyEvent
): void {
  const { tool_use_id, terminal_session_id } = event;
  if (!tool_use_id || !terminal_session_id) {
    return;
  }

  const store = FlowChatStore.getInstance();
  const location = store.findToolItemLocation(tool_use_id);

  if (location) {
    store.updateModelRoundItem(location.sessionId, location.dialogTurnId, tool_use_id, {
      terminalSessionId: terminal_session_id,
    } as any);
    pendingTerminalSessionIds.delete(tool_use_id);
    return;
  }

  pendingTerminalSessionIds.set(tool_use_id, terminal_session_id);
  log.debug('Cached terminal session for pending tool item', {
    toolUseId: tool_use_id,
    terminalSessionId: terminal_session_id,
  });
}
