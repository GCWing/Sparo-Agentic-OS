import {
  ProcessingPhase,
  SessionExecutionState,
  type SessionStateMachine,
} from '../state-machine/types';

export interface SessionInteractionProjection {
  canSend: boolean;
  canCancel: boolean;
  sendButtonMode: 'send' | 'cancel' | 'split' | 'confirm' | 'retry';
  inputDisabled: boolean;
  needsAttention: false | 'tool_confirm' | 'ask_user';
  progressLabel?: string;
}

export interface ProjectSessionInteractionOptions {
  processingInputDraftTrimmed?: string;
}

export function projectSessionInteraction(
  machine: SessionStateMachine,
  options?: ProjectSessionInteractionOptions,
): SessionInteractionProjection {
  const { currentState, context } = machine;
  const draftTrimmed =
    currentState === SessionExecutionState.PROCESSING ||
    currentState === SessionExecutionState.FINISHING ||
    currentState === SessionExecutionState.ERROR
      ? options?.processingInputDraftTrimmed?.trim() ?? ''
      : '';
  const hasQueuedInput = (context.queuedInput?.trim()?.length ?? 0) > 0 || draftTrimmed.length > 0;
  const hasPendingConfirmations = context.pendingToolConfirmations.size > 0;
  const isActive =
    currentState === SessionExecutionState.PROCESSING ||
    currentState === SessionExecutionState.FINISHING;

  return {
    canSend: currentState === SessionExecutionState.IDLE || currentState === SessionExecutionState.ERROR,
    canCancel: isActive && !hasPendingConfirmations,
    sendButtonMode: resolveSendButtonMode(currentState, context.processingPhase, hasQueuedInput, hasPendingConfirmations),
    inputDisabled: false,
    needsAttention: hasPendingConfirmations ? 'tool_confirm' : false,
    progressLabel: resolveProgressLabel(context.processingPhase),
  };
}

function resolveSendButtonMode(
  state: SessionExecutionState,
  phase: ProcessingPhase | null,
  hasQueuedInput: boolean,
  hasPendingConfirmations: boolean,
): SessionInteractionProjection['sendButtonMode'] {
  if (state === SessionExecutionState.ERROR) {
    return hasQueuedInput ? 'split' : 'retry';
  }

  if (hasPendingConfirmations || phase === ProcessingPhase.TOOL_CONFIRMING) {
    return 'confirm';
  }

  if (state === SessionExecutionState.FINISHING) {
    return hasQueuedInput ? 'split' : 'cancel';
  }

  if (state === SessionExecutionState.PROCESSING) {
    return hasQueuedInput ? 'split' : 'cancel';
  }

  return 'send';
}

function resolveProgressLabel(phase: ProcessingPhase | null): string | undefined {
  switch (phase) {
    case ProcessingPhase.COMPACTING:
      return 'Compressing session context...';
    case ProcessingPhase.STARTING:
      return 'Connecting to AI...';
    case ProcessingPhase.THINKING:
      return 'Thinking...';
    case ProcessingPhase.FINALIZING:
      return 'Finalizing response...';
    case ProcessingPhase.TOOL_CALLING:
      return 'Executing tools...';
    case ProcessingPhase.TOOL_CONFIRMING:
      return 'Waiting for tool confirmation...';
    default:
      return undefined;
  }
}
