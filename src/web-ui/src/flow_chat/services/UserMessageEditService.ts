import { snapshotAPI } from '@/infrastructure/api';
import type { ImageContextData } from '@/infrastructure/api/service-api/ImageContextTypes';
import { globalEventBus } from '@/infrastructure/event-bus';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import { stateMachineManager } from '../state-machine';
import { SessionExecutionState } from '../state-machine/types';
import { flowChatStore } from '../store/FlowChatStore';
import type { DialogTurn } from '../types/flow-chat';
import { FlowChatManager } from './FlowChatManager';

const log = createLogger('UserMessageEditService');

const CANCEL_SETTLE_TIMEOUT_MS = 5000;
const CANCEL_SETTLE_POLL_MS = 80;

export interface UserMessageEditImpact {
  turnIndex: number;
  isLatestTurn: boolean;
  isSessionBusy: boolean;
  runningTurnId: string | null;
  runningTurnIndex: number | null;
  willCancelRunningTurn: boolean;
}

export interface EditAndRerunUserMessageParams {
  sessionId: string;
  turnId: string;
  nextContent: string;
  imageDisplayData?: DialogTurn['userMessage']['images'];
}

function isBusyState(state: SessionExecutionState): boolean {
  return state === SessionExecutionState.PROCESSING || state === SessionExecutionState.FINISHING;
}

function isHumanEditableMessage(turn: DialogTurn): boolean {
  const triggerSource = turn.userMessage.triggerSource ?? turn.userMessage.metadata?.triggerSource;
  return !triggerSource || triggerSource === 'desktop_ui';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function mapImagesToBackendContexts(
  images: DialogTurn['userMessage']['images'] | undefined,
): ImageContextData[] | undefined {
  if (!images?.length) return undefined;

  const contexts = images
    .map(image => ({
      id: image.id,
      image_path: image.imagePath,
      data_url: image.dataUrl,
      mime_type: image.mimeType || 'image/png',
      metadata: {
        name: image.name,
      },
    }))
    .filter(image => image.image_path || image.data_url);

  return contexts.length > 0 ? contexts : undefined;
}

function getSessionTurn(sessionId: string, turnId: string): {
  turn: DialogTurn;
  turnIndex: number;
  isLatestTurn: boolean;
} {
  const session = flowChatStore.getState().sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session does not exist: ${sessionId}`);
  }

  if (session.isHistorical) {
    throw new Error('Session history is still loading. Try again after it finishes.');
  }

  if (session.isTransient) {
    throw new Error('This session does not support message editing.');
  }

  const turnIndex = session.dialogTurns.findIndex(turn => turn.id === turnId);
  if (turnIndex < 0) {
    throw new Error(`Dialog turn does not exist: ${turnId}`);
  }

  const turn = session.dialogTurns[turnIndex];
  if (!isHumanEditableMessage(turn)) {
    throw new Error('Only messages sent from the desktop chat input can be edited.');
  }

  return {
    turn,
    turnIndex,
    isLatestTurn: turnIndex === session.dialogTurns.length - 1,
  };
}

export function describeUserMessageEditImpact(sessionId: string, turnId: string): UserMessageEditImpact {
  const { turnIndex, isLatestTurn } = getSessionTurn(sessionId, turnId);
  const currentState = stateMachineManager.getCurrentState(sessionId);
  const snapshot = stateMachineManager.getSnapshot(sessionId);
  const runningTurnId = snapshot?.context.currentDialogTurnId ?? null;
  const session = flowChatStore.getState().sessions.get(sessionId);
  const runningTurnIndex = runningTurnId && session
    ? session.dialogTurns.findIndex(turn => turn.id === runningTurnId)
    : null;
  const isSessionBusy = isBusyState(currentState);

  if (isSessionBusy && runningTurnIndex !== null && runningTurnIndex >= 0 && runningTurnIndex < turnIndex) {
    throw new Error('A previous turn is still running. Wait until it finishes before editing this message.');
  }

  return {
    turnIndex,
    isLatestTurn,
    isSessionBusy,
    runningTurnId,
    runningTurnIndex: runningTurnIndex !== null && runningTurnIndex >= 0 ? runningTurnIndex : null,
    willCancelRunningTurn: isSessionBusy,
  };
}

async function waitForSessionNotBusy(sessionId: string): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < CANCEL_SETTLE_TIMEOUT_MS) {
    if (!isBusyState(stateMachineManager.getCurrentState(sessionId))) {
      return;
    }
    await sleep(CANCEL_SETTLE_POLL_MS);
  }

  throw new Error('The running turn did not stop in time. Try again after it finishes.');
}

async function cancelRunningTurnIfNeeded(sessionId: string): Promise<void> {
  if (!isBusyState(stateMachineManager.getCurrentState(sessionId))) {
    return;
  }

  const cancelled = await FlowChatManager.getInstance().cancelTaskForSession(sessionId);
  if (!cancelled && isBusyState(stateMachineManager.getCurrentState(sessionId))) {
    throw new Error('Failed to stop the running turn before editing.');
  }

  await waitForSessionNotBusy(sessionId);
}

export async function editAndRerunUserMessage({
  sessionId,
  turnId,
  nextContent,
  imageDisplayData,
}: EditAndRerunUserMessageParams): Promise<void> {
  const trimmedContent = nextContent.trim();
  if (!trimmedContent) {
    throw new Error('Edited message cannot be empty.');
  }

  const { turnIndex } = getSessionTurn(sessionId, turnId);
  const impact = describeUserMessageEditImpact(sessionId, turnId);

  try {
    if (impact.willCancelRunningTurn) {
      await cancelRunningTurnIfNeeded(sessionId);
    }

    const restoredFiles = await snapshotAPI.rollbackToTurn(sessionId, turnIndex, true);
    flowChatStore.truncateDialogTurnsFrom(sessionId, turnIndex);

    globalEventBus.emit('file-tree:refresh');
    restoredFiles.forEach(filePath => {
      globalEventBus.emit('editor:file-changed', { filePath });
    });

    const imageContexts = mapImagesToBackendContexts(imageDisplayData);

    await FlowChatManager.getInstance().sendMessage(
      trimmedContent,
      sessionId,
      trimmedContent,
      undefined,
      undefined,
      imageContexts
        ? {
            imageContexts,
            imageDisplayData,
          }
        : undefined,
    );
  } catch (error) {
    log.error('Failed to edit and rerun user message', {
      sessionId,
      turnId,
      turnIndex,
      error,
    });
    notificationService.error(error instanceof Error ? error.message : String(error));
    throw error;
  }
}
