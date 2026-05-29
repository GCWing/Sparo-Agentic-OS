import type { AnyFlowItem, DialogTurn, FlowToolItem, ModelRound } from '../types/flow-chat';
import type { RuntimeTerminalState } from './statusModel';
import { deriveToolRuntimeState, isRuntimeTerminalState } from './statusModel';

export type FlowTurnFinalizeReason =
  | 'completed'
  | 'user_cancelled'
  | 'error'
  | 'app_restart'
  | 'recovery';

export interface FinalizeFlowTurnOptions {
  reason: FlowTurnFinalizeReason;
  settledAt: number;
  error?: string;
  preserveWaitingConfirmation?: boolean;
}

export function finalizeFlowTurn(turn: DialogTurn, options: FinalizeFlowTurnOptions): DialogTurn {
  const finalTurnStatus = resolveTurnTerminalStatus(turn, options);

  return {
    ...turn,
    status: finalTurnStatus,
    error: options.error ?? turn.error,
    endTime: turn.endTime ?? options.settledAt,
    modelRounds: turn.modelRounds.map(round => finalizeRound(round, finalTurnStatus, options)),
  };
}

function resolveTurnTerminalStatus(
  turn: DialogTurn,
  options: FinalizeFlowTurnOptions,
): RuntimeTerminalState {
  if (isRuntimeTerminalState(turn.status)) {
    return turn.status;
  }
  if (options.reason === 'completed') {
    return hasNestedError(turn) ? 'error' : 'completed';
  }
  if (options.reason === 'error') {
    return 'error';
  }
  return 'cancelled';
}

function finalizeRound(
  round: ModelRound,
  parentStatus: RuntimeTerminalState,
  options: FinalizeFlowTurnOptions,
): ModelRound {
  const hasWaitingConfirmation = round.items.some(item =>
    item.type === 'tool' &&
    deriveToolRuntimeState(item as FlowToolItem).lifecycle === 'waiting_confirmation'
  );
  const roundStatus =
    options.preserveWaitingConfirmation && hasWaitingConfirmation
      ? 'pending_confirmation'
      : parentStatus;

  return {
    ...round,
    status: roundStatus,
    isStreaming: false,
    isComplete: true,
    endTime: round.endTime ?? options.settledAt,
    items: round.items.map(item => finalizeItem(item, parentStatus, options)),
  };
}

function finalizeItem(
  item: AnyFlowItem,
  parentStatus: RuntimeTerminalState,
  options: FinalizeFlowTurnOptions,
): AnyFlowItem {
  if (item.type === 'text') {
    return {
      ...item,
      status: isRuntimeTerminalState(item.status) ? item.status : parentStatus,
      isStreaming: false,
    };
  }

  if (item.type === 'thinking') {
    return {
      ...item,
      status: isRuntimeTerminalState(item.status) ? item.status : parentStatus,
      isStreaming: false,
      isCollapsed: true,
    };
  }

  if (item.type === 'tool') {
    const tool = item as FlowToolItem;
    const runtime = deriveToolRuntimeState(tool);
    const keepWaitingConfirmation =
      options.preserveWaitingConfirmation &&
      runtime.lifecycle === 'waiting_confirmation' &&
      options.reason !== 'user_cancelled';
    const nextStatus = keepWaitingConfirmation
      ? 'pending_confirmation'
      : isRuntimeTerminalState(runtime.lifecycle)
        ? runtime.lifecycle
        : parentStatus;

    return {
      ...tool,
      status: nextStatus,
      runtime: {
        ...runtime,
        lifecycle: nextStatus === 'pending_confirmation' ? 'waiting_confirmation' : nextStatus,
        inputPhase: runtime.inputPhase === 'streaming' ? 'parsed' : runtime.inputPhase,
        partialInput: undefined,
        endedAt: tool.endTime ?? options.settledAt,
      },
      endTime: tool.endTime ?? options.settledAt,
      interruptionReason:
        options.reason === 'app_restart' && nextStatus === 'cancelled'
          ? 'app_restart'
          : tool.interruptionReason,
    };
  }

  return {
    ...item,
    status: isRuntimeTerminalState(item.status) ? item.status : parentStatus,
  };
}

function hasNestedError(turn: DialogTurn): boolean {
  if (turn.error) return true;
  return turn.modelRounds.some(round =>
    round.status === 'error' ||
    round.items.some(item => {
      if (item.status === 'error') return true;
      if (item.type !== 'tool') return false;
      return (item as FlowToolItem).toolResult?.success === false;
    })
  );
}
