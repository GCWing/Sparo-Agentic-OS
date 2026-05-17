import { useEffect, useState } from 'react';
import { createLogger } from '@/shared/utils/logger';
import { FlowChatStore } from '../../../store/FlowChatStore';

const log = createLogger('ComposerRecommendations');

export interface ComposerRecommendationContext {
  workspacePath?: string;
  sessionId?: string;
  turnIndex?: number;
  modifiedFiles?: string[];
}

export function useComposerRecommendations({
  effectiveTargetSessionId,
  isProcessing,
  workspacePath,
}: {
  effectiveTargetSessionId?: string | null;
  isProcessing?: boolean;
  workspacePath?: string;
}) {
  const [recommendationContext, setRecommendationContext] =
    useState<ComposerRecommendationContext | null>(null);

  useEffect(() => {
    if (!effectiveTargetSessionId || !workspacePath) {
      return;
    }

    const store = FlowChatStore.getInstance();
    const state = store.getState();
    const session = state.sessions.get(effectiveTargetSessionId);

    if (!session || session.dialogTurns.length === 0) {
      return;
    }

    const lastTurn = session.dialogTurns[session.dialogTurns.length - 1];

    if (lastTurn.status === 'completed') {
      const modifiedFiles: string[] = [];

      for (const round of lastTurn.modelRounds) {
        for (const item of round.items) {
          if (item.type === 'tool') {
            const toolItem = item as import('../../../types/flow-chat').FlowToolItem;
            const fileModifyTools = ['write_file', 'edit_file', 'create_file', 'delete_file'];
            if (fileModifyTools.includes(toolItem.toolName)) {
              const toolInput = toolItem.toolCall?.input;
              if (toolInput && typeof toolInput === 'object') {
                const inputRecord = toolInput as Record<string, unknown>;
                const filePath = inputRecord.file_path || inputRecord.path || inputRecord.filePath;
                if (typeof filePath === 'string') {
                  modifiedFiles.push(filePath);
                }
              }
            }
          }
        }
      }

      if (modifiedFiles.length > 0) {
        log.debug('File modifications detected, updating recommendation context', { modifiedFiles });
        setRecommendationContext({
          workspacePath,
          sessionId: effectiveTargetSessionId,
          turnIndex: session.dialogTurns.length - 1,
          modifiedFiles: [...new Set(modifiedFiles)],
        });
      }
    }
  }, [effectiveTargetSessionId, workspacePath, isProcessing]);

  return recommendationContext;
}
