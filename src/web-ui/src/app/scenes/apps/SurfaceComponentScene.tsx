/**
 * SurfaceComponentScene — standalone scene tab for a Product App surface.
 * Mounts SurfaceComponentRunner; close via overlay home button (does not stop worker).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { DotMatrixLoader } from '@/design-system';
import { surfaceComponentAPI } from '@/infrastructure/api/service-api/SurfaceComponentAPI';
import { api } from '@/infrastructure/api/service-api/ApiClient';
import type { SurfaceComponent } from '@/infrastructure/api/service-api/SurfaceComponentAPI';
import { useTheme } from '@/infrastructure/theme/hooks/useTheme';
import { createLogger } from '@/shared/utils/logger';
import { Button } from '@/design-system';
import { useSceneManager } from '@/app/hooks/useSceneManager';
import type { WorkspaceSceneId } from '@/app/navigation/workspaceSceneTypes';
import { useSurfaceComponentStore } from './surface-component/surfaceComponentStore';
import { useI18n } from '@/infrastructure/i18n';
import { useSurfaceComponentActions } from './surface-component/hooks/useSurfaceComponentActions';
import { useHeaderStore } from '@/app/stores/headerStore';
import { resolveSurfaceComponentMeta } from './surface-component/surfaceComponentI18n';
import { isCompositeSurfaceComponent } from './surface-component/surfaceComponentInteraction';
import { openSurfaceComponent } from './surface-component/surfaceComponentWorkbenchService';
import {
  appScopeFromWorkspacePath,
  appScopeIdentity,
  normalizeAppScope,
  systemAppScope,
  type AppScope,
  workspacePathFromAppScope,
} from '@/shared/types/app-scope';
import './SurfaceComponentScene.scss';

const log = createLogger('SurfaceComponentScene');

const SurfaceComponentRunner = React.lazy(() => import('./surface-component/components/SurfaceComponentRunner'));

interface SurfaceComponentSceneProps {
  appId: string;
  workspacePath?: string;
  scope?: AppScope | null;
}

const SurfaceComponentScene: React.FC<SurfaceComponentSceneProps> = ({ appId, workspacePath, scope }) => {
  const openApp = useSurfaceComponentStore((state) => state.openApp);
  const closeApp = useSurfaceComponentStore((state) => state.closeApp);
  const setRecentAppIds = useSurfaceComponentStore((state) => state.setRecentAppIds);
  const { themeType } = useTheme();
  const { closeScene } = useSceneManager();
  const { t, currentLanguage } = useI18n('scenes/apps');
  const setContextNavOverride = useHeaderStore((state) => state.setContextNavOverride);
  const clearContextNavOverride = useHeaderStore((state) => state.clearContextNavOverride);

  const [app, setApp] = useState<SurfaceComponent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const effectiveScope = useMemo(
    () => normalizeAppScope(scope || appScopeFromWorkspacePath(workspacePath) || systemAppScope()),
    [scope, workspacePath],
  );
  const effectiveWorkspacePath = workspacePathFromAppScope(effectiveScope);

  const {
    recompile,
    state: { recompiling },
  } = useSurfaceComponentActions(appId, { scope: effectiveScope });

  useEffect(() => {
    openApp(appId);
    void surfaceComponentAPI.recordRecentSurfaceComponent(appId)
      .then(setRecentAppIds)
      .catch((error) => log.warn('Failed to persist recent Product App surface', { appId, error }));
    return () => { closeApp(appId); };
  }, [appId, openApp, closeApp, setRecentAppIds]);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const theme = themeType ?? 'dark';
      const loaded = await surfaceComponentAPI.getSurfaceComponent(id, theme, effectiveWorkspacePath);
      if (isCompositeSurfaceComponent(loaded)) {
        setApp(null);
        setError(null);
        await openSurfaceComponent(loaded, {
          scope: effectiveScope,
          locale: currentLanguage,
          theme,
        });
        return;
      }
      setApp(loaded);
      setError(null);
    } catch (err) {
      log.error('Failed to load Product App surface', { appId: id, error: err });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [currentLanguage, effectiveScope, effectiveWorkspacePath, themeType]);

  useEffect(() => {
    if (appId) void load(appId);
  }, [appId, load]);

  useEffect(() => {
    const tabId = `app-surface:${appId}` as WorkspaceSceneId;
    const shouldHandle = (payload?: { id?: string }) => payload?.id === appId;

    const unlistenUpdated = api.listen<{ id?: string }>('surface-component-updated', (payload) => {
      if (shouldHandle(payload)) void load(appId);
    });
    const unlistenRecompiled = api.listen<{ id?: string }>('surface-component-recompiled', (payload) => {
      if (shouldHandle(payload)) void load(appId);
    });
    const unlistenRolledBack = api.listen<{ id?: string }>('surface-component-rolled-back', (payload) => {
      if (shouldHandle(payload)) void load(appId);
    });
    const unlistenRestarted = api.listen<{ id?: string }>('surface-component-worker-restarted', (payload) => {
      if (shouldHandle(payload)) void load(appId);
    });
    const unlistenDeleted = api.listen<{ id?: string }>('surface-component-deleted', (payload) => {
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
    const surfaceId = `app-surface:${appId}`;
    setContextNavOverride(surfaceId, {
      title: app ? resolveSurfaceComponentMeta(app, currentLanguage).name : t('productSystem.surfaceFallback'),
      actions: [
        {
          id: 'refresh',
          label: t('surfaceComponent.scene.reload'),
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
    app,
    appId,
    clearContextNavOverride,
    handleRefresh,
    loading,
    recompiling,
    setContextNavOverride,
    t,
    currentLanguage,
  ]);

  const runnerKey = useMemo(
    () =>
        app
        ? `${app.id}:${app.runtime?.source_revision ?? 'runtime'}:${themeType ?? 'dark'}:${appScopeIdentity(effectiveScope)}:${reloadNonce}`
        : `loading:${appId}:${reloadNonce}`,
    [app, appId, effectiveScope, reloadNonce, themeType],
  );

  return (
    <div className="surface-component-scene" data-testid="surface-component-scene">
      <div className="surface-component-scene__content">
        {loading && !app ? (
          <div className="surface-component-scene__loading">
            <DotMatrixLoader size="medium" className="surface-component-scene__loading-dots" />
            <span>{t('surfaceComponent.scene.loading')}</span>
          </div>
        ) : null}
        {error ? (
          <div className="surface-component-scene__error">
            <AlertTriangle size={32} strokeWidth={1.5} />
            <p>{t('surfaceComponent.scene.loadFailed', { error })}</p>
            <Button variant="secondary" size="small" onClick={() => void load(appId)}>
              {t('surfaceComponent.scene.retry')}
            </Button>
          </div>
        ) : null}
        {app ? (
          <React.Suspense fallback={null}>
            <SurfaceComponentRunner
              key={runnerKey}
              app={app}
              scope={effectiveScope}
              workspacePath={effectiveWorkspacePath}
            />
          </React.Suspense>
        ) : null}
        {(loading || recompiling) && app ? (
          <div className="surface-component-scene__updating" role="status" aria-live="polite">
            <DotMatrixLoader size="tiny" className="surface-component-scene__loading-dots" />
            <span>{t('surfaceComponent.scene.updating')}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default SurfaceComponentScene;
