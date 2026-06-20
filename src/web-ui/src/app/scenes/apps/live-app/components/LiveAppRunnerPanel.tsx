import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button, DotMatrixLoader } from '@/design-system';
import { liveAppAPI } from '@/infrastructure/api/service-api/LiveAppAPI';
import type { LiveApp } from '@/infrastructure/api/service-api/LiveAppAPI';
import { useTheme } from '@/infrastructure/theme/hooks/useTheme';
import { useI18n } from '@/infrastructure/i18n';
import { createLogger } from '@/shared/utils/logger';
import type { LiveAppWorkbenchSessionMetadata } from '@/shared/types/session-history';
import { useLiveAppStore } from '../liveAppStore';
import LiveAppRunner from './LiveAppRunner';
import './LiveAppRunnerPanel.scss';

const log = createLogger('LiveAppRunnerPanel');

interface LiveAppRunnerPanelProps {
  appId?: string;
  workspacePath?: string;
  route?: string;
  tabId?: string;
  sessionId?: string;
  liveAppWorkbench?: LiveAppWorkbenchSessionMetadata;
}

const LiveAppRunnerPanel: React.FC<LiveAppRunnerPanelProps> = ({
  appId,
  workspacePath,
  route,
  tabId,
  sessionId,
  liveAppWorkbench,
}) => {
  const { themeType } = useTheme();
  const { t } = useI18n('components');
  const openApp = useLiveAppStore((state) => state.openApp);
  const closeApp = useLiveAppStore((state) => state.closeApp);
  const setRecentAppIds = useLiveAppStore((state) => state.setRecentAppIds);
  const [app, setApp] = useState<LiveApp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!appId) return;
    openApp(appId);
    void liveAppAPI.recordRecentLiveApp(appId)
      .then(setRecentAppIds)
      .catch((error) => log.warn('Failed to persist recent Live App', { appId, error }));
    return () => closeApp(appId);
  }, [appId, closeApp, openApp, setRecentAppIds]);

  const load = useCallback(async () => {
    if (!appId) return;
    setLoading(true);
    try {
      const loaded = await liveAppAPI.getLiveApp(
        appId,
        themeType ?? 'dark',
        workspacePath,
      );
      setApp(loaded);
      setError(null);
    } catch (error) {
      log.error('Failed to load Live App runner panel', { appId, error });
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [appId, themeType, workspacePath]);

  useEffect(() => {
    void load();
  }, [load]);

  const runnerKey = useMemo(
    () => app
      ? [
        app.id,
        app.runtime?.source_revision ?? 'runtime',
        themeType ?? 'dark',
        workspacePath ?? '',
        route ?? '/',
        tabId ?? '',
      ].join(':')
      : 'empty',
    [app, route, tabId, themeType, workspacePath],
  );

  if (!appId) {
    return (
      <div
        className="live-app-runner-panel live-app-runner-panel--empty"
        data-testid="live-app-runner-panel"
        data-app-id={appId}
      >
        <AlertTriangle size={24} />
        <p>{t('flexiblePanel.errors.liveAppRunnerMissingAppId')}</p>
      </div>
    );
  }

  return (
    <div
      className="live-app-runner-panel"
      data-testid="live-app-runner-panel"
      data-app-id={appId}
      data-route={route || '/'}
    >
      {loading && !app ? (
        <div className="live-app-runner-panel__state">
          <DotMatrixLoader size="small" />
          <span>{t('flexiblePanel.loading.liveAppRunner')}</span>
        </div>
      ) : null}
      {error ? (
        <div className="live-app-runner-panel__state live-app-runner-panel__state--error">
          <AlertTriangle size={26} />
          <p>{error}</p>
          <Button variant="secondary" size="small" onClick={() => void load()}>
            {t('flexiblePanel.actions.retry')}
          </Button>
        </div>
      ) : null}
      {app ? (
        <React.Suspense fallback={null}>
          <LiveAppRunner
            key={runnerKey}
            app={app}
            route={route}
            tabId={tabId}
            sessionId={sessionId}
            workspacePath={workspacePath}
            liveAppWorkbench={liveAppWorkbench}
          />
        </React.Suspense>
      ) : null}
      {loading && app ? (
        <div className="live-app-runner-panel__updating" role="status">
          <DotMatrixLoader size="tiny" />
          <span>{t('flexiblePanel.loading.liveAppRunnerUpdating')}</span>
        </div>
      ) : null}
    </div>
  );
};

export default LiveAppRunnerPanel;
