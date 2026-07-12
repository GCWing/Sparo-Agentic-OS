import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { Button, DotMatrixLoader, LoadingSkeleton } from '@/design-system';
import { isSessionTranscriptLoading } from '../../domain/sessionLoadPhase';
import type { SessionLoadPhase } from '../../types/flow-chat';

interface TranscriptSessionState {
  sessionId?: string;
  loadPhase?: SessionLoadPhase;
}

export function shouldShowSessionTranscriptLoading(
  requestedSessionId: string | null | undefined,
  session: TranscriptSessionState | null | undefined,
): boolean {
  if (!requestedSessionId) return false;
  if (session?.sessionId !== requestedSessionId) return true;
  return !session || session.loadPhase === undefined || isSessionTranscriptLoading({
    loadPhase: session.loadPhase,
  });
}

export function shouldShowSessionTranscriptError(
  requestedSessionId: string | null | undefined,
  session: TranscriptSessionState | null | undefined,
): boolean {
  return Boolean(
    requestedSessionId
    && session?.sessionId === requestedSessionId
    && session.loadPhase === 'hydrate-failed',
  );
}

export const SessionTranscriptLoading: React.FC = () => {
  const { t } = useTranslation('flow-chat');
  const label = t('session.loadingHistory');

  return (
    <div
      className="session-transcript-loading"
      role="status"
      aria-live="polite"
      aria-label={label}
      data-testid="session-transcript-loading"
    >
      <div className="session-transcript-loading__label">
        <DotMatrixLoader size="small" />
        <span>{label}</span>
      </div>
      <div className="session-transcript-loading__messages" aria-hidden="true">
        <LoadingSkeleton compact lines={2} />
        <LoadingSkeleton compact lines={3} />
      </div>
    </div>
  );
};

SessionTranscriptLoading.displayName = 'SessionTranscriptLoading';

export const SessionTranscriptError: React.FC<{
  sessionId: string;
}> = ({ sessionId }) => {
  const { t } = useTranslation('flow-chat');
  const [retrying, setRetrying] = useState(false);
  const retry = useCallback(async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      const { flowChatManager } = await import('../../services/FlowChatManager');
      await flowChatManager.retrySessionHistory(sessionId);
    } catch {
      // The persistent error state remains visible and provides another retry.
    } finally {
      setRetrying(false);
    }
  }, [retrying, sessionId]);

  return (
    <div className="session-transcript-error" role="alert">
      <AlertTriangle size={24} />
      <span>{t('session.historyLoadFailed')}</span>
      <Button variant="secondary" size="small" disabled={retrying} onClick={() => void retry()}>
        {t('session.retryHistory')}
      </Button>
    </div>
  );
};

SessionTranscriptError.displayName = 'SessionTranscriptError';
