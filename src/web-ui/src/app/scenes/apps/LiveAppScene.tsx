/**
 * LiveAppScene — standalone scene tab for a single Live App.
 * Mounts LiveAppRunner; close via overlay home button (does not stop worker).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { liveAppAPI } from '@/infrastructure/api/service-api/LiveAppAPI';
import { api } from '@/infrastructure/api/service-api/ApiClient';
import type { LiveApp } from '@/infrastructure/api/service-api/LiveAppAPI';
import { useTheme } from '@/infrastructure/theme/hooks/useTheme';
import { useLastUsedWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { createLogger } from '@/shared/utils/logger';
import { Button } from '@/design-system';
import { useSceneManager } from '@/app/hooks/useSceneManager';
import type { WorkspaceSceneId } from '@/app/navigation/workspaceSceneTypes';
import { useLiveAppStore } from './live-app/liveAppStore';
import { useI18n } from '@/infrastructure/i18n';
import { useLiveAppActions } from './live-app/hooks/useLiveAppActions';
import { useHeaderStore } from '@/app/stores/headerStore';
import './LiveAppScene.scss';

const log = createLogger('LiveAppScene');

const LiveAppRunner = React.lazy(() => import('./live-app/components/LiveAppRunner'));

interface LiveAppSceneProps {
  appId: string;
}

const LiveAppScene: React.FC<LiveAppSceneProps> = ({ appId }) => {
  const openApp = useLiveAppStore((state) => state.openApp);
  const closeApp = useLiveAppStore((state) => state.closeApp);
  const { themeType } = useTheme();
  const { workspacePath } = useLastUsedWorkspace();
  const { closeScene } = useSceneManager();
  const { t } = useI18n('scenes/apps');
  const setContextNavOverride = useHeaderStore((state) => state.setContextNavOverride);
  const clearContextNavOverride = useHeaderStore((state) => state.clearContextNavOverride);

  const [app, setApp] = useState<LiveApp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const {
    recompile,
    state: { recompiling },
  } = useLiveAppActions(appId);

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
    const tabId = `live-app:${appId}` as WorkspaceSceneId;
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

  const handleRefresh = useCallback(() => {
    void recompile(() => {
      setError(null);
      setReloadNonce((v) => v + 1);
    });
  }, [recompile]);

  useEffect(() => {
    const surfaceId = `live-app:${appId}`;
    setContextNavOverride(surfaceId, {
      title: app?.name || 'Live App',
      actions: [
        {
          id: 'refresh',
          label: t('liveApp.scene.reload'),
          icon: <RefreshCw size={13} strokeWidth={2.25} aria-hidden="true" />,
          disabled: loading || recompiling,
          onClick: handleRefresh,
        },
      ],
    });

    return () => {
      clearContextNavOverride(surfaceId);
    };
  }, [
    app?.name,
    appId,
    clearContextNavOverride,
    handleRefresh,
    loading,
    recompiling,
    setContextNavOverride,
    t,
  ]);

  const runnerKey = useMemo(
    () =>
      app
        ? `${app.id}:${app.runtime?.source_revision ?? 'runtime'}:${themeType ?? 'dark'}:${workspacePath ?? ''}:${reloadNonce}`
        : `loading:${appId}:${reloadNonce}`,
    [app, appId, reloadNonce, themeType, workspacePath],
  );

  return (
    <div className="live-app-scene">
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
        {(loading || recompiling) && app ? (
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
