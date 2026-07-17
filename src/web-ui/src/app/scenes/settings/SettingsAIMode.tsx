import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoaderCircle, MessageSquarePlus } from 'lucide-react';
import { Alert, Button, ConfirmDialog, IconButton, Spinner } from '@/design-system';
import { FlowChatSessionSurface, FlowChatManager } from '@/flow_chat';
import { SESSION_DESCRIPTORS } from '@/flow_chat/domain/sessionDescriptor';
import { useFlowChatStoreSelector } from '@/flow_chat/hooks/useFlowChatStoreSelector';
import { useSessionDerivedState } from '@/flow_chat/hooks/useSessionStateMachine';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import { configSnapshotStore } from '@/infrastructure/config';
import { createLogger } from '@/shared/utils/logger';
import { settingsFlowSessionApi, type SettingsFlowSessionIdentity } from './settingsFlowSessionApi';
import {
  adoptResetSettingsFlowSession,
  SettingsFlowSessionAdoptionError,
} from './settingsFlowSessionTransition';
import { createSettingsFlowSendContext } from './settingsFlowSendContext';
import { shouldOfferSettingsSessionReset } from './settingsSessionControls';
import { useSettingsStore } from './settingsStore';

const log = createLogger('SettingsAIMode');

export interface SettingsAIModeProps {
  active?: boolean;
  disabled?: boolean;
}

async function attachSettingsSession(identity: SettingsFlowSessionIdentity): Promise<void> {
  const existing = flowChatStore.getState().sessions.get(identity.sessionId);
  if (!existing) {
    flowChatStore.addExternalSession(
      identity.sessionId,
      identity.sessionName,
      SESSION_DESCRIPTORS.settings,
      identity.workspacePath ?? undefined,
      {
        sessionKind: 'internal',
        isTransient: true,
      },
      identity.storageScope,
    );
  }

  const session = flowChatStore.getState().sessions.get(identity.sessionId);
  if (
    session
    && session.dialogTurns.length === 0
    && !flowChatStore.hasSessionHistoryWarmed(identity.sessionId)
  ) {
    await flowChatStore.loadSessionHistory(
      identity.sessionId,
      identity.workspacePath ?? '',
      undefined,
      identity.storageScope,
    );
  }
}

export function SettingsAIMode({ active = true, disabled = false }: SettingsAIModeProps) {
  const { t } = useTranslation('settings/ai-mode');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [resetErrorKey, setResetErrorKey] = useState<'resetError' | 'resetAttachError' | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const derivedState = useSessionDerivedState(sessionId, '');
  const isProcessing = Boolean(derivedState?.isProcessing);
  const turnCount = useFlowChatStoreSelector((state) => (
    sessionId ? state.sessions.get(sessionId)?.dialogTurns.length ?? 0 : 0
  ));
  const showReset = shouldOfferSettingsSessionReset(turnCount);

  const ensureSession = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const identity = await settingsFlowSessionApi.ensure();
      await attachSettingsSession(identity);
      setSessionId(identity.sessionId);
    } catch (error) {
      log.error('Failed to initialize settings FlowChat session', { error });
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void ensureSession();
  }, [ensureSession]);

  const resolveSendContext = useCallback(async () => {
    const snapshot = await configSnapshotStore.start();
    return createSettingsFlowSendContext(
      snapshot.revision,
      Object.keys(useSettingsStore.getState().dirtySettings),
    );
  }, []);

  const resetSession = useCallback(async () => {
    if (!sessionId || isProcessing || resetting) return;
    setResetDialogOpen(false);
    setResetting(true);
    setResetErrorKey(null);
    try {
      const nextIdentity = await settingsFlowSessionApi.reset(sessionId);
      await adoptResetSettingsFlowSession({
        previousSessionId: sessionId,
        identity: nextIdentity,
        publishIdentity: (identity) => setSessionId(identity.sessionId),
        detachPrevious: (previousSessionId) => {
          FlowChatManager.getInstance().detachLocalSession(previousSessionId);
        },
        attachIdentity: attachSettingsSession,
      });
    } catch (error) {
      if (error instanceof SettingsFlowSessionAdoptionError) {
        log.error('Failed to attach new settings FlowChat session', {
          previousSessionId: sessionId,
          nextSessionId: error.identity.sessionId,
          error: error.originalError,
        });
        setResetErrorKey('resetAttachError');
      } else {
        log.error('Failed to reset settings FlowChat session', { sessionId, error });
        setResetErrorKey('resetError');
      }
    } finally {
      setResetting(false);
    }
  }, [isProcessing, resetting, sessionId]);

  if (loading) {
    return (
      <div className="sparo-settings-ai-mode sparo-settings-ai-mode--centered" role="status">
        <Spinner size="medium" />
        <span>{t('session.loading')}</span>
      </div>
    );
  }

  if (loadError || !sessionId) {
    return (
      <div className="sparo-settings-ai-mode sparo-settings-ai-mode--centered">
        <Alert type="error" message={t('session.loadError')} />
        <Button variant="secondary" size="small" onClick={() => void ensureSession()}>
          {t('session.retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="sparo-settings-ai-mode">
      {showReset ? (
        <div className="sparo-settings-ai-mode__toolbar">
          <IconButton
            type="button"
            variant="accent"
            size="medium"
            shape="circle"
            isLoading={resetting}
            disabled={disabled || isProcessing}
            aria-label={resetting ? t('session.resetting') : t('session.newConversation')}
            tooltip={t('session.newConversation')}
            tooltipPlacement="left"
            title={isProcessing ? t('session.resetBusy') : undefined}
            onClick={() => setResetDialogOpen(true)}
          >
            {resetting ? <LoaderCircle aria-hidden /> : <MessageSquarePlus aria-hidden />}
          </IconButton>
        </div>
      ) : null}

      {resetErrorKey ? (
        <Alert
          className="sparo-settings-ai-mode__reset-error"
          type="error"
          message={t(`session.${resetErrorKey}`)}
        />
      ) : null}

      <FlowChatSessionSurface
        className="sparo-settings-ai-mode__chat"
        sessionId={sessionId}
        profileId="settings"
        active={active}
        disabled={disabled}
        resolveSendContext={resolveSendContext}
      />

      <ConfirmDialog
        open={resetDialogOpen}
        onOpenChange={setResetDialogOpen}
        title={t('session.resetDialog.title')}
        message={t('session.resetDialog.message')}
        confirmText={t('session.resetDialog.confirm')}
        cancelText={t('session.resetDialog.cancel')}
        onConfirm={() => void resetSession()}
        onCancel={() => setResetDialogOpen(false)}
      />
    </div>
  );
}
