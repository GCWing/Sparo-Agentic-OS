/**
 * ProductAppHostSurfaceScene - standalone scene tab for a Product App host surface.
 * Mounts the Product App Runtime host runner; close via overlay home button (does not stop worker).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button, DotMatrixLoader } from '@/design-system';
import { api } from '@/infrastructure/api/service-api/ApiClient';
import { useTheme } from '@/infrastructure/theme/hooks/useTheme';
import { createLogger } from '@/shared/utils/logger';
import { useSceneManager } from '@/app/hooks/useSceneManager';
import type { WorkspaceSceneId } from '@/app/navigation/workspaceSceneTypes';
import { useProductAppRuntimeStore } from './product-app-runtime/productAppRuntimeStore';
import { useI18n } from '@/infrastructure/i18n';
import { useProductAppRuntimeHostActions } from './product-app-runtime/productAppRuntimeHostActions';
import { useHeaderStore } from '@/app/stores/headerStore';
import { resolveProductAppHostSurfaceMeta } from './product-app-runtime/productAppRuntimeHostMeta';
import {
  productAppRuntimeHostAPI,
  type ProductAppHostSurface,
} from '@/infrastructure/api/service-api/ProductAppRuntimeHostAPI';
import {
  appScopeFromWorkspacePath,
  appScopeIdentity,
  normalizeAppScope,
  systemAppScope,
  type AppScope,
  workspacePathFromAppScope,
} from '@/shared/types/app-scope';
import {
  productAppRuntimeHostEvents,
  type ProductAppRuntimeContext,
} from '@/shared/types/product-app-runtime';
import './ProductAppHostSurfaceScene.scss';

const log = createLogger('ProductAppHostSurfaceScene');

const ProductAppRuntimeIframeHost = React.lazy(() => import('./product-app-runtime/ProductAppRuntimeIframeHost'));

interface ProductAppHostSurfaceSceneProps {
  appId: string;
  workspacePath?: string;
  scope?: AppScope | null;
  runtimeContext?: ProductAppRuntimeContext | null;
}

const ProductAppHostSurfaceScene: React.FC<ProductAppHostSurfaceSceneProps> = ({
  appId,
  workspacePath,
  scope,
  runtimeContext,
}) => {
  const openApp = useProductAppRuntimeStore((state) => state.openApp);
  const closeApp = useProductAppRuntimeStore((state) => state.closeApp);
  const setRecentAppIds = useProductAppRuntimeStore((state) => state.setRecentAppIds);
  const { themeType } = useTheme();
  const { closeScene } = useSceneManager();
  const { t, currentLanguage } = useI18n('scenes/apps');
  const setContextNavOverride = useHeaderStore((state) => state.setContextNavOverride);
  const clearContextNavOverride = useHeaderStore((state) => state.clearContextNavOverride);

  const [app, setApp] = useState<ProductAppHostSurface | null>(null);
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
  } = useProductAppRuntimeHostActions(appId, { scope: effectiveScope });

  useEffect(() => {
    openApp(appId);
    void productAppRuntimeHostAPI.recordRecentHostSurface(appId)
      .then(setRecentAppIds)
      .catch((error) => log.warn('Failed to persist recent host surface', { appId, error }));
    return () => { closeApp(appId); };
  }, [appId, openApp, closeApp, setRecentAppIds]);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const theme = themeType ?? 'dark';
      const loaded = await productAppRuntimeHostAPI.getHostSurface(id, theme, effectiveWorkspacePath);
      setApp(loaded);
      setError(null);
    } catch (err) {
      log.error('Failed to load host surface', { appId: id, error: err });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [effectiveWorkspacePath, themeType]);

  useEffect(() => {
    if (appId) void load(appId);
  }, [appId, load]);

  useEffect(() => {
    const tabId = `app-surface:${appId}` as WorkspaceSceneId;
    const shouldHandle = (payload?: { id?: string }) => payload?.id === appId;

    const unlistenUpdated = api.listen<{ id?: string }>(productAppRuntimeHostEvents.updated, (payload) => {
      if (shouldHandle(payload)) void load(appId);
    });
    const unlistenRecompiled = api.listen<{ id?: string }>(productAppRuntimeHostEvents.recompiled, (payload) => {
      if (shouldHandle(payload)) void load(appId);
    });
    const unlistenRolledBack = api.listen<{ id?: string }>(productAppRuntimeHostEvents.rolledBack, (payload) => {
      if (shouldHandle(payload)) void load(appId);
    });
    const unlistenRestarted = api.listen<{ id?: string }>(productAppRuntimeHostEvents.workerRestarted, (payload) => {
      if (shouldHandle(payload)) void load(appId);
    });
    const unlistenDeleted = api.listen<{ id?: string }>(productAppRuntimeHostEvents.deleted, (payload) => {
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
      title: app ? resolveProductAppHostSurfaceMeta(app, currentLanguage).name : t('productSystem.surfaceFallback'),
      actions: [
        {
          id: 'refresh',
          label: t('productAppRuntime.scene.reload'),
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
    <div className="product-app-host-surface-scene" data-testid="product-app-host-surface-scene">
      <div className="product-app-host-surface-scene__content">
        {loading && !app ? (
          <div className="product-app-host-surface-scene__loading">
            <DotMatrixLoader size="medium" className="product-app-host-surface-scene__loading-dots" />
            <span>{t('productAppRuntime.scene.loading')}</span>
          </div>
        ) : null}
        {error ? (
          <div className="product-app-host-surface-scene__error">
            <AlertTriangle size={32} strokeWidth={1.5} />
            <p>{t('productAppRuntime.scene.loadFailed', { error })}</p>
            <Button variant="secondary" size="small" onClick={() => void load(appId)}>
              {t('productAppRuntime.scene.retry')}
            </Button>
          </div>
        ) : null}
        {app ? (
          <React.Suspense fallback={null}>
            <ProductAppRuntimeIframeHost
              key={runnerKey}
              app={app}
              scope={effectiveScope}
              workspacePath={effectiveWorkspacePath}
              runtimeContext={runtimeContext}
            />
          </React.Suspense>
        ) : null}
        {(loading || recompiling) && app ? (
          <div className="product-app-host-surface-scene__updating" role="status" aria-live="polite">
            <DotMatrixLoader size="tiny" className="product-app-host-surface-scene__loading-dots" />
            <span>{t('productAppRuntime.scene.updating')}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default ProductAppHostSurfaceScene;
