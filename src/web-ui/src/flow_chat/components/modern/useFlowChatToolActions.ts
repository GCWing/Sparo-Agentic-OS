/**
 * Tool confirmation/rejection actions for Modern FlowChat.
 */

import { useCallback } from 'react';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import { flowChatStore } from '../../store/FlowChatStore';
import type { DialogTurn, FlowItem, FlowToolItem, ModelRound } from '../../types/flow-chat';

const log = createLogger('useFlowChatToolActions');

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

export function useFlowChatToolActions() {
  const handleToolConfirm = useCallback(async (toolId: string, updatedInput?: any) => {
    try {
      const { ownerSessionId, toolItem, turnId } = resolveToolContext(toolId);

      if (!ownerSessionId || !toolItem || !turnId) {
        notificationService.error(`Tool confirmation failed: tool item ${toolId} not found in current session`);
        return;
      }

      const finalInput = updatedInput || toolItem.toolCall?.input;

      flowChatStore.updateModelRoundItem(ownerSessionId, turnId, toolId, {
        userConfirmed: true,
        status: 'confirmed',
        toolCall: {
          ...toolItem.toolCall,
          input: finalInput,
        },
      } as any);

      const { agentService } = await import('../../../shared/services/agent-service');
      await agentService.confirmToolExecution(
        ownerSessionId,
        toolId,
        'confirm',
        finalInput,
      );
    } catch (error) {
      log.error('Tool confirmation failed', error);
      notificationService.error(`Tool confirmation failed: ${error}`);
    }
  }, []);

  const handleToolReject = useCallback(async (toolId: string) => {
    try {
      const { ownerSessionId, toolItem, turnId } = resolveToolContext(toolId);

      if (!ownerSessionId || !toolItem || !turnId) {
        log.warn('Tool rejection failed: tool item not found', { toolId });
        return;
      }

      flowChatStore.updateModelRoundItem(ownerSessionId, turnId, toolId, {
        userConfirmed: false,
        status: 'cancelled',
      } as any);

      const { agentService } = await import('../../../shared/services/agent-service');
      await agentService.confirmToolExecution(
        ownerSessionId,
        toolId,
        'reject',
      );
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
