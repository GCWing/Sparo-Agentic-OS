import type {
  DialogTurn,
  FlowTextItem,
  FlowThinkingItem,
  FlowToolItem,
  ModelRound,
} from '../types/flow-chat';

const TRANSIENT_TURN_STATUSES = new Set(['pending', 'processing', 'finishing', 'image_analyzing', 'cancelling', 'inprogress']);
const RECOVERABLE_ROUND_STATUSES = new Set(['pending', 'streaming', 'pending_confirmation']);
const TRANSIENT_TOOL_STATUSES = new Set(['pending', 'preparing', 'streaming', 'running', 'receiving', 'starting', 'analyzing']);
const TERMINAL_TOOL_STATUSES = new Set(['completed', 'cancelled', 'error', 'pending_confirmation', 'confirmed']);

export function isTransientToolStatus(status: unknown): boolean {
  return typeof status === 'string' && TRANSIENT_TOOL_STATUSES.has(status);
}

function hasNestedError(turn: Pick<DialogTurn, 'error'> & { modelRounds?: Array<Partial<ModelRound> & { toolItems?: any[]; textItems?: any[]; thinkingItems?: any[] }> }): boolean {
  if (turn.error) {
    return true;
  }

  return (turn.modelRounds ?? []).some(round => {
    if (round.status === 'error') {
      return true;
    }

    const items = [
      ...(round.items ?? []),
      ...(round.toolItems ?? []),
      ...(round.textItems ?? []),
      ...(round.thinkingItems ?? []),
    ];

    return items.some((item: any) =>
      item?.status === 'error' ||
      item?.toolResult?.success === false ||
      item?.tool_result?.success === false
    );
  });
}

function getTurnFallbackStatus(turn: Pick<DialogTurn, 'error'> & { modelRounds?: Array<Partial<ModelRound> & { toolItems?: any[]; textItems?: any[]; thinkingItems?: any[] }> }): DialogTurn['status'] {
  return hasNestedError(turn) ? 'error' : 'cancelled';
}

export function normalizeRecoveredTurnStatus(
  status: unknown,
  turn: Pick<DialogTurn, 'error'> & { modelRounds?: Array<Partial<ModelRound> & { toolItems?: any[]; textItems?: any[]; thinkingItems?: any[] }> },
): DialogTurn['status'] {
  if (status === 'completed' || status === 'cancelled' || status === 'error') {
    return status;
  }

  if (typeof status === 'string' && TRANSIENT_TURN_STATUSES.has(status)) {
    return getTurnFallbackStatus(turn);
  }

  return getTurnFallbackStatus(turn);
}

export function normalizeRecoveredRoundStatus(
  status: unknown,
  parentTurnStatus: DialogTurn['status'],
): ModelRound['status'] {
  if (status === 'pending_confirmation') {
    return status;
  }

  if (status === 'completed' || status === 'cancelled' || status === 'error') {
    return status;
  }

  if (typeof status === 'string' && RECOVERABLE_ROUND_STATUSES.has(status)) {
    if (parentTurnStatus === 'completed' || parentTurnStatus === 'error' || parentTurnStatus === 'cancelled') {
      return parentTurnStatus;
    }
  }

  return parentTurnStatus === 'completed' ? 'completed' : parentTurnStatus === 'error' ? 'error' : 'cancelled';
}

export function normalizeRecoveredTextStatus(
  status: unknown,
  parentTurnStatus: DialogTurn['status'],
): FlowTextItem['status'] {
  if (status === 'completed' || status === 'cancelled' || status === 'error') {
    return status;
  }

  if (parentTurnStatus === 'completed') {
    return 'completed';
  }

  if (parentTurnStatus === 'error') {
    return 'error';
  }

  return 'cancelled';
}

export function normalizeRecoveredThinkingStatus(
  status: unknown,
  parentTurnStatus: DialogTurn['status'],
): FlowThinkingItem['status'] {
  if (status === 'completed' || status === 'cancelled' || status === 'error') {
    return status;
  }

  if (parentTurnStatus === 'completed') {
    return 'completed';
  }

  if (parentTurnStatus === 'error') {
    return 'error';
  }

  return 'cancelled';
}

export function normalizeRecoveredToolStatus(
  status: unknown,
  parentTurnStatus: DialogTurn['status'],
  toolResult?: Pick<NonNullable<FlowToolItem['toolResult']>, 'success' | 'error'> | null,
  options?: { preservePendingConfirmation?: boolean },
): FlowToolItem['status'] {
  if ((status === 'pending_confirmation' || status === 'confirmed') && options?.preservePendingConfirmation) {
    return status;
  }

  if (status === 'completed' || status === 'cancelled' || status === 'error') {
    return status;
  }

  if (parentTurnStatus === 'cancelled') {
    return 'cancelled';
  }

  if (parentTurnStatus === 'error') {
    return toolResult?.success === false && toolResult.error ? 'error' : 'cancelled';
  }

  if (parentTurnStatus === 'completed') {
    if (toolResult?.success === false) {
      return 'error';
    }
    return 'completed';
  }

  if (typeof status === 'string' && (TRANSIENT_TOOL_STATUSES.has(status) || TERMINAL_TOOL_STATUSES.has(status))) {
    return 'cancelled';
  }

  if (toolResult?.success === false) {
    return 'error';
  }

  return 'cancelled';
}
