import type { DialogTurn, FlowTextItem, FlowThinkingItem, FlowToolItem, Session } from '../types/flow-chat';
import {
  deriveDialogTurnState,
  deriveModelRoundState,
  deriveTextBlockState,
  deriveThinkingBlockState,
  deriveToolRuntimeState,
} from '../runtime/statusModel';

export interface StreamingOutputProjection {
  isStreamingOutput: boolean;
  isDraining: boolean;
  activeTurnId?: string;
  activeRoundId?: string;
  growingTextItemIds: string[];
}

export function projectStreamingOutput(session: Session | null | undefined): StreamingOutputProjection {
  const turn = getLatestActiveTurn(session);
  if (!turn) {
    return {
      isStreamingOutput: false,
      isDraining: false,
      growingTextItemIds: [],
    };
  }

  const turnState = deriveDialogTurnState(turn);
  const latestRound = turn.modelRounds[turn.modelRounds.length - 1];
  const growingTextItemIds: string[] = [];
  let hasLiveRuntime = false;

  for (const round of turn.modelRounds) {
    const roundState = deriveModelRoundState(round);
    if (roundState === 'generating' || roundState === 'waiting_tool' || roundState === 'waiting_confirmation') {
      hasLiveRuntime = true;
    }

    for (const item of round.items) {
      if (item.type === 'text') {
        const state = deriveTextBlockState(item as FlowTextItem);
        if (state === 'streaming') {
          growingTextItemIds.push(item.id);
          hasLiveRuntime = true;
        }
      } else if (item.type === 'thinking') {
        const state = deriveThinkingBlockState(item as FlowThinkingItem);
        if (state === 'streaming') {
          growingTextItemIds.push(item.id);
          hasLiveRuntime = true;
        }
      } else if (item.type === 'tool') {
        const runtime = deriveToolRuntimeState(item as FlowToolItem);
        if (
          runtime.lifecycle === 'preparing' ||
          runtime.lifecycle === 'ready' ||
          runtime.lifecycle === 'waiting_confirmation' ||
          runtime.lifecycle === 'running' ||
          runtime.inputPhase === 'streaming'
        ) {
          hasLiveRuntime = true;
        }
      }
    }
  }

  const isDraining = turnState === 'draining';
  return {
    isStreamingOutput:
      turnState === 'image_analyzing' ||
      turnState === 'running' ||
      turnState === 'waiting_confirmation' ||
      hasLiveRuntime,
    isDraining,
    activeTurnId: turn.id,
    activeRoundId: latestRound?.id,
    growingTextItemIds,
  };
}

function getLatestActiveTurn(session: Session | null | undefined): DialogTurn | null {
  if (!session?.dialogTurns.length) return null;
  return session.dialogTurns[session.dialogTurns.length - 1] ?? null;
}
