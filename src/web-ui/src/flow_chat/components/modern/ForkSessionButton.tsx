import React, { useState, useCallback } from 'react';
import { GitFork, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/design-system';
import { flowChatManager } from '../../services/FlowChatManager';
import { flowChatStore } from '../../store/FlowChatStore';
import { resolveSessionRelationship } from '../../utils/sessionMetadata';
import { createLogger } from '@/shared/utils/logger';
import { notificationService } from '@/shared/notification-system';

const log = createLogger('ForkSessionButton');

interface ForkSessionButtonProps {
  sessionId?: string;
  turnId: string;
}

export const ForkSessionButton: React.FC<ForkSessionButtonProps> = ({
  sessionId,
  turnId,
}) => {
  const { t } = useTranslation('flow-chat');
  const [isForking, setIsForking] = useState(false);
  const session = sessionId ? flowChatStore.getState().sessions.get(sessionId) : undefined;
  const isBtwSession = resolveSessionRelationship(session).isBtw;

  const handleFork = useCallback(async () => {
    if (!sessionId || isForking) {
      return;
    }

    setIsForking(true);
    try {
      await flowChatManager.forkChatSession(sessionId, turnId);
    } catch (error) {
      log.error('Failed to fork session', { sessionId, turnId, error });
      notificationService.error(
        t('modelRound.forkFailed', { defaultValue: 'Failed to fork session' }),
        { duration: 3500 }
      );
    } finally {
      setIsForking(false);
    }
  }, [isForking, sessionId, t, turnId]);

  if (!sessionId || isBtwSession) {
    return null;
  }

  return (
    <IconButton
      className="model-round-item__action model-round-item__fork-action"
      onClick={handleFork}
      disabled={isForking}
      tooltip={t('modelRound.forkDialog', { defaultValue: 'Fork session from here' })}
      tooltipPlacement="top"
      aria-label={t('modelRound.forkDialog', { defaultValue: 'Fork session from here' })}
      isLoading={isForking}
      size="xs"
      variant="ghost"
    >
      {isForking ? <Loader2 size={14} className="spinning" /> : <GitFork size={14} />}
    </IconButton>
  );
};

ForkSessionButton.displayName = 'ForkSessionButton';
