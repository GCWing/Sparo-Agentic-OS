import React, { useEffect, useState, useCallback } from 'react';
import { useI18n } from '../i18n';
import { RemoteSessionManager } from '../services/RemoteSessionManager';
import { useMobileStore } from '../services/store';
import { useShellStore } from '../app/shellStore';
import ChatPage from './ChatPage';
import './AgenticOsHomeScene.scss';

interface AgenticOsHomeSceneProps {
  sessionMgr: RemoteSessionManager;
  onSelectSession: (sessionId: string, sessionName?: string, sessionMode?: string) => void;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return '早安';
  if (h < 18) return '下午好';
  return '晚上好';
}

const AgenticOsHomeScene: React.FC<AgenticOsHomeSceneProps> = ({ sessionMgr }) => {
  const { t } = useI18n();
  const [agenticOsSessionId, setAgenticOsSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { authenticatedUserId, selectedWorkspace } = useMobileStore();
  const setSessionContext = useShellStore((s) => s.setSessionContext);

  const initAgenticOs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const id = await sessionMgr.getOrCreateAgenticOsSession(selectedWorkspace?.path);
      setAgenticOsSessionId(id);
      setSessionContext(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [sessionMgr, selectedWorkspace?.path, setSessionContext]);

  useEffect(() => {
    void initAgenticOs();
  }, [initAgenticOs]);

  const userId = authenticatedUserId ?? '';
  const userName = userId.split('@')[0] || userId;

  if (loading) {
    return (
      <div className="agentic-os-home agentic-os-home--loading">
        <div className="agentic-os-home__orbit-spinner" />
        <span className="agentic-os-home__loading-text">{t('common.loading')}</span>
      </div>
    );
  }

  if (error || !agenticOsSessionId) {
    return (
      <div className="agentic-os-home agentic-os-home--error">
        <div className="agentic-os-home__error-dot" aria-hidden="true" />
        <span>{error ?? t('common.loading')}</span>
        <button type="button" className="agentic-os-home__retry" onClick={() => void initAgenticOs()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="agentic-os-home">
      <ChatPage
        sessionMgr={sessionMgr}
        sessionId={agenticOsSessionId}
        sessionName={t('sessions.agenticOsSession')}
        onBack={() => {}}
        embedded
      />
    </div>
  );
};

export default AgenticOsHomeScene;
