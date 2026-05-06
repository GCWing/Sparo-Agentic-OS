/**
 * LiveAppScene — standalone scene tab for a single Live App.
 * Mounts LiveAppRunner; close via overlay home button (does not stop worker).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import { liveAppAPI } from '@/infrastructure/api/service-api/LiveAppAPI';
import { api } from '@/infrastructure/api/service-api/ApiClient';
import type { LiveApp } from '@/infrastructure/api/service-api/LiveAppAPI';
import { useTheme } from '@/infrastructure/theme/hooks/useTheme';
import { useLastUsedWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { createLogger } from '@/shared/utils/logger';
import { Button } from '@/component-library';
import { useSceneManager } from '@/app/hooks/useSceneManager';
import type { OverlaySceneId } from '@/app/overlay/types';
import { useLiveAppStore } from './live-app/liveAppStore';
import { useI18n } from '@/infrastructure/i18n';
import { useLiveAppActions } from './live-app/hooks/useLiveAppActions';
import LiveAppRuntimeBadges from './live-app/components/LiveAppRuntimeBadges';
import { buildLiveAppRuntimeSummary } from './live-app/liveAppRuntimeModel';
import './LiveAppScene.scss';

const log = createLogger('LiveAppScene');

const LiveAppRunner = React.lazy(() => import('./live-app/components/LiveAppRunner'));

interface LiveAppSceneProps {
  appId: string;
}

const LiveAppScene: React.FC<LiveAppSceneProps> = ({ appId }) => {
  const openApp = useLiveAppStore((state) => state.openApp);
  const closeApp = useLiveAppStore((state) => state.closeApp);
  const runningWorkerIds = useLiveAppStore((state) => state.runningWorkerIds);
  const runtimeStatus = useLiveAppStore((state) => state.runtimeStatus);
  const { themeType } = useTheme();
  const { workspacePath } = useLastUsedWorkspace();
  const { closeScene } = useSceneManager();
  const { t } = useI18n('scenes/apps');

  const [app, setApp] = useState<LiveApp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const actions = useLiveAppActions(appId);

  useEffect(() => {
    openApp(appId);
    return () => { closeApp(appId); };
  }, [appId, openApp, closeApp]);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const theme = themeType ?? 'dark';
      const loaded = await liveAppAPI.getLiveApp(id, theme, workspacePath || undefined);
      setApp(loaded);
      setError(null);
    } catch (err) {
      log.error('Failed to load live app', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [themeType, workspacePath]);

  useEffect(() => {
    if (appId) void load(appId);
  }, [appId, load]);

  useEffect(() => {
    const tabId = `live-app:${appId}` as OverlaySceneId;
    const shouldHandle = (payload?: { id?: string }) => payload?.id === appId;

    const unlistenUpdated = api.listen<{ id?: string }>('liveapp-updated', (payload) => {
      if (shouldHandle(payload)) void load(appId);
    });
    const unlistenRecompiled = api.listen<{ id?: string }>('liveapp-recompiled', (payload) => {
      if (shouldHandle(payload)) void load(appId);
    });
    const unlistenRolledBack = api.listen<{ id?: string }>('liveapp-rolled-back', (payload) => {
      if (shouldHandle(payload)) void load(appId);
    });
    const unlistenRestarted = api.listen<{ id?: string }>('liveapp-worker-restarted', (payload) => {
      if (shouldHandle(payload)) void load(appId);
    });
    const unlistenDeleted = api.listen<{ id?: string }>('liveapp-deleted', (payload) => {
      if (shouldHandle(payload)) closeScene(tabId);
    });

    return () => {
      unlistenUpdated();
      unlistenRecompiled();
      unlistenRolledBack();
      unlistenRestarted();
      unlistenDeleted();
    };
  }, [appId, closeScene, load]);

  const handleReload = useCallback(() => {
    setReloadNonce((v) => v + 1);
    void load(appId);
  }, [appId, load]);

  const isRunning = runningWorkerIds.includes(appId);
  const runnerKey = useMemo(
    () =>
      app
        ? `${app.id}:${app.runtime?.source_revision ?? 'runtime'}:${themeType ?? 'dark'}:${workspacePath ?? ''}:${reloadNonce}`
        : `loading:${appId}:${reloadNonce}`,
    [app, appId, reloadNonce, themeType, workspacePath],
  );

  const runtimeSummary = useMemo(() => {
    if (!app) return null;
    return buildLiveAppRuntimeSummary(app, { isOpen: true, isRunning, runtimeStatus });
  }, [app, isRunning, runtimeStatus]);

  return (
    <div className="live-app-scene">
      <div className="live-app-scene__header">
        <div className="live-app-scene__header-center">
          {app ? (
            <span className="live-app-scene__title">{app.name}</span>
          ) : (
            <span className="live-app-scene__title live-app-scene__title--loading">Live App</span>
          )}
          {runtimeSummary ? (
            <LiveAppRuntimeBadges summary={runtimeSummary} t={t} className="live-app-scene__badges" />
          ) : null}
        </div>

        <div className="live-app-scene__header-actions">
          {runtimeSummary?.depsDirty ? (
            <Button
              variant="secondary"
              size="small"
              onClick={() => void actions.installDeps(() => void load(appId))}
              disabled={actions.state.installingDeps}
            >
              {t('liveApp.actions.installDeps')}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="small"
            onClick={() => void actions.recompile()}
            disabled={actions.state.recompiling}
          >
            {t('liveApp.actions.recompile')}
          </Button>
          <Button
            variant="ghost"
            size="small"
            onClick={() => void actions.syncFromFs((synced) => setApp(synced))}
            disabled={actions.state.syncing}
          >
            {t('liveApp.actions.syncFromFs')}
          </Button>
          {isRunning ? (
            <Button
              variant="secondary"
              size="small"
              onClick={() => void actions.stopWorker()}
              disabled={actions.state.restartingWorker}
            >
              {t('liveApp.detail.stop')}
            </Button>
          ) : runtimeSummary?.workerRestartRequired ? (
            <Button
              variant="secondary"
              size="small"
              onClick={() => void actions.stopWorker(() => handleReload())}
              disabled={actions.state.restartingWorker}
            >
              {t('liveApp.actions.restartWorker')}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="small"
            onClick={handleReload}
            disabled={loading}
            aria-label={t('liveApp.scene.reload')}
          >
            {loading ? (
              <Loader2 size={14} className="live-app-scene__spinning" />
            ) : (
              t('liveApp.scene.reload')
            )}
          </Button>
        </div>
      </div>

      <div className="live-app-scene__content">
        {loading && !app ? (
          <div className="live-app-scene__loading">
            <Loader2 size={28} className="live-app-scene__spinning" strokeWidth={1.5} />
            <span>{t('liveApp.scene.loading')}</span>
          </div>
        ) : null}
        {error ? (
          <div className="live-app-scene__error">
            <AlertTriangle size={32} strokeWidth={1.5} />
            <p>{t('liveApp.scene.loadFailed', { error })}</p>
            <Button variant="secondary" size="small" onClick={() => void load(appId)}>
              {t('liveApp.scene.retry')}
            </Button>
          </div>
        ) : null}
        {app ? (
          <React.Suspense fallback={null}>
            <LiveAppRunner key={runnerKey} app={app} />
          </React.Suspense>
        ) : null}
        {loading && app ? (
          <div className="live-app-scene__updating" role="status" aria-live="polite">
            <Loader2 size={16} className="live-app-scene__spinning" />
            <span>{t('liveApp.scene.updating')}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default LiveAppScene;
