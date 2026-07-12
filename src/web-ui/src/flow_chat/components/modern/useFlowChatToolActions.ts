/**
 * Tool confirmation/rejection actions for Modern FlowChat.
 */

import { useCallback } from 'react';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import { flowChatStore } from '../../store/FlowChatStore';
import { flowChatManager } from '../../services/FlowChatManager';
import type { DialogTurn, FlowItem, FlowToolItem, ModelRound } from '../../types/flow-chat';

const log = createLogger('useFlowChatToolActions');
const pendingToolActions = new Map<string, Promise<void>>();

interface ResolvedToolContext {
  ownerSessionId: string | null;
  toolItem: FlowToolItem | null;
  turnId: string | null;
}

function resolveToolContext(toolId: string): ResolvedToolContext {
  let toolItem: FlowToolItem | null = null;
  let turnId: string | null = null;
  let ownerSessionId: string | null = null;

  for (const session of flowChatStore.getState().sessions.values()) {
    for (const turn of session.dialogTurns as DialogTurn[]) {
      for (const modelRound of turn.modelRounds as ModelRound[]) {
        const item = modelRound.items.find((candidate: FlowItem) => (
          candidate.type === 'tool' && candidate.id === toolId
        )) as FlowToolItem | undefined;

        if (item) {
          toolItem = item;
          turnId = turn.id;
          ownerSessionId = session.sessionId;
          break;
        }
      }

      if (toolItem) {
        break;
      }
    }

    if (toolItem) {
      break;
    }
  }

  return {
    ownerSessionId,
    toolItem,
    turnId,
  };
}

function runToolActionSingleFlight(toolId: string, action: () => Promise<void>): Promise<void> {
  const existing = pendingToolActions.get(toolId);
  if (existing) return existing;

  let pending: Promise<void>;
  pending = action().finally(() => {
    if (pendingToolActions.get(toolId) === pending) {
      pendingToolActions.delete(toolId);
    }
  });
  pendingToolActions.set(toolId, pending);
  return pending;
}

export function useFlowChatToolActions() {
  const handleToolConfirm = useCallback(async (toolId: string, updatedInput?: any) => {
    try {
      await runToolActionSingleFlight(toolId, async () => {
        const initial = resolveToolContext(toolId);
        if (!initial.ownerSessionId || !initial.toolItem || !initial.turnId) {
          throw new Error(`tool item ${toolId} not found in current session`);
        }

        await flowChatManager.ensureBackendSession(initial.ownerSessionId);
        const current = resolveToolContext(toolId);
        if (
          current.ownerSessionId !== initial.ownerSessionId
          || !current.toolItem
          || !current.turnId
          || current.toolItem.status !== 'pending_confirmation'
        ) {
          log.debug('Ignoring stale tool confirmation action', { toolId });
          return;
        }

        const finalInput = updatedInput ?? current.toolItem.toolCall?.input;
        const previousState = {
          userConfirmed: current.toolItem.userConfirmed,
          status: current.toolItem.status,
          toolCall: current.toolItem.toolCall,
        };
        flowChatStore.updateModelRoundItem(current.ownerSessionId, current.turnId, toolId, {
          userConfirmed: true,
          status: 'confirmed',
          toolCall: {
            ...current.toolItem.toolCall,
            input: finalInput,
          },
        } as any);
        const optimisticItem = resolveToolContext(toolId).toolItem;

        try {
          const { agentService } = await import('../../../shared/services/agent-service');
          await agentService.confirmToolExecution(
            current.ownerSessionId,
            toolId,
            'confirm',
            finalInput,
          );
        } catch (error) {
          if (resolveToolContext(toolId).toolItem === optimisticItem) {
            flowChatStore.updateModelRoundItem(
              current.ownerSessionId,
              current.turnId,
              toolId,
              previousState as any,
            );
          }
          throw error;
        }
      });
    } catch (error) {
      log.error('Tool confirmation failed', error);
      notificationService.error(`Tool confirmation failed: ${error}`);
    }
  }, []);

  const handleToolReject = useCallback(async (toolId: string) => {
    try {
      await runToolActionSingleFlight(toolId, async () => {
        const initial = resolveToolContext(toolId);
        if (!initial.ownerSessionId || !initial.toolItem || !initial.turnId) {
          throw new Error(`tool item ${toolId} not found in current session`);
        }

        await flowChatManager.ensureBackendSession(initial.ownerSessionId);
        const current = resolveToolContext(toolId);
        if (
          current.ownerSessionId !== initial.ownerSessionId
          || !current.toolItem
          || !current.turnId
          || current.toolItem.status !== 'pending_confirmation'
        ) {
          log.debug('Ignoring stale tool rejection action', { toolId });
          return;
        }

        const previousState = {
          userConfirmed: current.toolItem.userConfirmed,
          status: current.toolItem.status,
        };
        flowChatStore.updateModelRoundItem(current.ownerSessionId, current.turnId, toolId, {
          userConfirmed: false,
          status: 'cancelled',
        } as any);
        const optimisticItem = resolveToolContext(toolId).toolItem;

        try {
          const { agentService } = await import('../../../shared/services/agent-service');
          await agentService.confirmToolExecution(
            current.ownerSessionId,
            toolId,
            'reject',
          );
        } catch (error) {
          if (resolveToolContext(toolId).toolItem === optimisticItem) {
            flowChatStore.updateModelRoundItem(
              current.ownerSessionId,
              current.turnId,
              toolId,
              previousState as any,
            );
          }
          throw error;
        }
      });
    } catch (error) {
      log.error('Tool rejection failed', error);
      notificationService.error(`Tool rejection failed: ${error}`);
    }
  }, []);

  return {
    handleToolConfirm,
    handleToolReject,
  };
}
