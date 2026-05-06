import React, { useEffect, useState, useCallback } from 'react';
import { useI18n } from '../i18n';
import { RemoteSessionManager } from '../services/RemoteSessionManager';
import { useMobileStore } from '../services/store';
import { useShellStore } from '../app/shellStore';
import ChatPage from './ChatPage';
import './DispatcherHomeScene.scss';

interface DispatcherHomeSceneProps {
  sessionMgr: RemoteSessionManager;
  onSelectSession: (sessionId: string, sessionName?: string, sessionMode?: string) => void;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return '早安';
  if (h < 18) return '下午好';
  return '晚上好';
}

const DispatcherHomeScene: React.FC<DispatcherHomeSceneProps> = ({ sessionMgr }) => {
  const { t } = useI18n();
  const [dispatcherSessionId, setDispatcherSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { authenticatedUserId, selectedWorkspace } = useMobileStore();
  const setSessionContext = useShellStore((s) => s.setSessionContext);

  const initDispatcher = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const id = await sessionMgr.getOrCreateDispatcherSession(selectedWorkspace?.path);
      setDispatcherSessionId(id);
      setSessionContext(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [sessionMgr, selectedWorkspace?.path, setSessionContext]);

  useEffect(() => {
    void initDispatcher();
  }, [initDispatcher]);

  const userId = authenticatedUserId ?? '';
  const userName = userId.split('@')[0] || userId;

  if (loading) {
    return (
      <div className="dispatcher-home dispatcher-home--loading">
        <div className="dispatcher-home__orbit-spinner" />
        <span className="dispatcher-home__loading-text">{t('common.loading')}</span>
      </div>
    );
  }

  if (error || !dispatcherSessionId) {
    return (
      <div className="dispatcher-home dispatcher-home--error">
        <div className="dispatcher-home__error-dot" aria-hidden="true" />
        <span>{error ?? t('common.loading')}</span>
        <button type="button" className="dispatcher-home__retry" onClick={() => void initDispatcher()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="dispatcher-home">
      <ChatPage
        sessionMgr={sessionMgr}
        sessionId={dispatcherSessionId}
        sessionName={t('sessions.dispatcherSession')}
        onBack={() => {}}
        embedded
      />
    </div>
  );
};

export default DispatcherHomeScene;
