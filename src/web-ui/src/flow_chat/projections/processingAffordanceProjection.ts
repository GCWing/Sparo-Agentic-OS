import type {
  AnyFlowItem,
  DialogTurn,
  FlowTextItem,
  FlowThinkingItem,
  FlowToolItem,
  Session,
} from '../types/flow-chat';
import { getToolViewState } from '../runtime/toolViewState';

export type ProcessingAffordanceReason =
  | 'awaiting_first_signal'
  | 'between_visible_steps';

export type ProcessingAffordanceKind = 'none' | 'ambient_wait';

export interface ProcessingAffordanceProjection {
  kind: ProcessingAffordanceKind;
  reason?: ProcessingAffordanceReason;
  reserveSpace: boolean;
  activeTurnId?: string;
  latestVisibleActivityKey?: string;
}

export interface ProcessingAffordanceInput {
  session: Session | null | undefined;
  isProcessing: boolean;
  processingPhase?: string | null;
}

export function projectProcessingAffordance({
  session,
  isProcessing,
  processingPhase,
}: ProcessingAffordanceInput): ProcessingAffordanceProjection {
  const activeTurn = getLatestTurn(session);

  if (!activeTurn || !isProcessing || processingPhase === 'tool_confirming') {
    return hiddenProjection();
  }

  if (hasVisibleRunningAffordance(activeTurn)) {
    return {
      kind: 'none',
      reserveSpace: true,
      activeTurnId: activeTurn.id,
      latestVisibleActivityKey: getLatestVisibleActivityKey(activeTurn),
    };
  }

  const hasVisibleHistory = hasAnyVisibleItem(activeTurn);
  return {
    kind: 'ambient_wait',
    reason: hasVisibleHistory ? 'between_visible_steps' : 'awaiting_first_signal',
    reserveSpace: true,
    activeTurnId: activeTurn.id,
    latestVisibleActivityKey: getLatestVisibleActivityKey(activeTurn),
  };
}

export function hasVisibleRunningAffordance(turn: DialogTurn): boolean {
  if (turn.imageAnalysisPhase?.status === 'analyzing') {
    return true;
  }

  for (const round of turn.modelRounds) {
    for (const item of round.items) {
      if (isVisibleRunningItem(item)) {
        return true;
      }
    }
  }

  return false;
}

function isVisibleRunningItem(item: AnyFlowItem): boolean {
  if (item.type === 'text') {
    return isStreamingTextLikeItem(item);
  }

  if (item.type === 'thinking') {
    return isStreamingTextLikeItem(item);
  }

  if (item.type === 'tool') {
    return getToolViewState(item as FlowToolItem).isLive;
  }

  if (item.type === 'image-analysis') {
    return item.status === 'analyzing';
  }

  return false;
}

function isStreamingTextLikeItem(item: FlowTextItem | FlowThinkingItem): boolean {
  return item.isStreaming && item.status !== 'completed' && item.status !== 'cancelled' && item.status !== 'error';
}

function hasAnyVisibleItem(turn: DialogTurn): boolean {
  if (turn.imageAnalysisPhase?.items.length) {
    return true;
  }

  return turn.modelRounds.some(round => round.items.length > 0);
}

function getLatestVisibleActivityKey(turn: DialogTurn): string | undefined {
  for (let roundIndex = turn.modelRounds.length - 1; roundIndex >= 0; roundIndex -= 1) {
    const round = turn.modelRounds[roundIndex];
    if (!round) continue;

    for (let itemIndex = round.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = round.items[itemIndex];
      if (item) {
        return `${round.id}:${item.id}:${item.status}`;
      }
    }
  }

  const imageItem = turn.imageAnalysisPhase?.items[turn.imageAnalysisPhase.items.length - 1];
  if (imageItem) {
    return `image:${imageItem.id}:${imageItem.status}`;
  }

  return undefined;
}

function getLatestTurn(session: Session | null | undefined): DialogTurn | null {
  if (!session?.dialogTurns.length) return null;
  return session.dialogTurns[session.dialogTurns.length - 1] ?? null;
}

function hiddenProjection(): ProcessingAffordanceProjection {
  return {
    kind: 'none',
    reserveSpace: false,
  };
}
