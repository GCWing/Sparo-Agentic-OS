import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button, DotMatrixLoader } from '@/design-system';
import { useTheme } from '@/infrastructure/theme/hooks/useTheme';
import { useI18n } from '@/infrastructure/i18n';
import { createLogger } from '@/shared/utils/logger';
import type { ProductAppRuntimeSessionMetadata } from '@/shared/types/session-history';
import {
  appScopeFromWorkspacePath,
  appScopeIdentity,
  normalizeAppScope,
  systemAppScope,
  type AppScope,
  workspacePathFromAppScope,
} from '@/shared/types/app-scope';
import type { ProductAppRuntimeContext } from '@/shared/types/product-app-runtime';
import { useProductAppRuntimeStore } from './productAppRuntimeStore';
import ProductAppRuntimeIframeHost from './ProductAppRuntimeIframeHost';
import {
  productAppRuntimeHostAPI,
  type ProductAppHostSurface,
} from '@/infrastructure/api/service-api/ProductAppRuntimeHostAPI';
import './ProductAppRuntimePanel.scss';

const log = createLogger('ProductAppRuntimePanel');

interface ProductAppRuntimePanelProps {
  appId?: string;
  scope?: AppScope | null;
  workspacePath?: string;
  runtimeContext?: ProductAppRuntimeContext | null;
  route?: string;
  tabId?: string;
  sessionId?: string;
  productAppRuntime?: ProductAppRuntimeSessionMetadata;
}

const ProductAppRuntimePanel: React.FC<ProductAppRuntimePanelProps> = ({
  appId,
  scope,
  workspacePath,
  runtimeContext,
  route,
  tabId,
  sessionId,
  productAppRuntime,
}) => {
  const { themeType } = useTheme();
  const { t } = useI18n('components');
  const openApp = useProductAppRuntimeStore((state) => state.openApp);
  const closeApp = useProductAppRuntimeStore((state) => state.closeApp);
  const setRecentAppIds = useProductAppRuntimeStore((state) => state.setRecentAppIds);
  const [app, setApp] = useState<ProductAppHostSurface | null>(null);
  const [loading, setLoading] = useState(Boolean(appId));
  const [previewReady, setPreviewReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadRequestRef = useRef(0);
  const effectiveScope = useMemo(
    () => normalizeAppScope(
      scope ||
      productAppRuntime?.scope ||
      appScopeFromWorkspacePath(workspacePath) ||
      systemAppScope(),
    ),
    [productAppRuntime?.scope, scope, workspacePath],
  );
  const effectiveWorkspacePath = workspacePathFromAppScope(effectiveScope);

  useEffect(() => {
    if (!appId) return;
    openApp(appId);
    void productAppRuntimeHostAPI.recordRecentHostSurface(appId)
      .then(setRecentAppIds)
      .catch((error) => log.warn('Failed to persist recent Product App host surface', { appId, error }));
    return () => closeApp(appId);
  }, [appId, closeApp, openApp, setRecentAppIds]);

  const load = useCallback(async () => {
    if (!appId) return;
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setApp(null);
    setPreviewReady(false);
    setError(null);
    try {
      const loaded = await productAppRuntimeHostAPI.getHostSurface(
        appId,
        themeType ?? 'dark',
        effectiveWorkspacePath,
      );
      if (requestId !== loadRequestRef.current) return;
      setApp(loaded);
    } catch (error) {
      if (requestId !== loadRequestRef.current) return;
      log.error('Failed to load Product App runtime panel', { appId, error });
      setApp(null);
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false);
      }
    }
  }, [appId, effectiveWorkspacePath, themeType]);

  useEffect(() => {
    void load();
    return () => {
      loadRequestRef.current += 1;
    };
  }, [load]);

  const runnerKey = useMemo(
    () => app
      ? [
        app.id,
        app.runtime?.source_revision ?? 'runtime',
        themeType ?? 'dark',
        appScopeIdentity(effectiveScope),
        route ?? '/',
        tabId ?? '',
      ].join(':')
      : 'empty',
    [app, effectiveScope, route, tabId, themeType],
  );

  const handlePreviewBootTimeout = useCallback(() => {
    log.warn('Product App runtime readiness timed out', { appId });
    productAppRuntimeHostAPI.invalidateHostSurface(appId);
    setPreviewReady(false);
    setApp(null);
    setError(t('flexiblePanel.errors.productAppRuntimeBootTimeout'));
  }, [appId, t]);

  if (!appId) {
    return (
      <div
        className="product-app-runtime-panel product-app-runtime-panel--empty"
        data-testid="product-app-runtime-panel"
        data-app-id={appId}
        data-product-app-id={runtimeContext?.appId ?? productAppRuntime?.appId ?? appId}
      >
        <AlertTriangle size={24} />
        <p>{t('flexiblePanel.errors.productAppRuntimeMissingHost')}</p>
      </div>
    );
  }

  return (
    <div
      className="product-app-runtime-panel"
      data-testid="product-app-runtime-panel"
      data-app-id={appId}
      data-product-app-id={runtimeContext?.appId ?? productAppRuntime?.appId ?? appId}
      data-route={route || '/'}
      aria-busy={loading || (Boolean(app) && !previewReady)}
    >
      {loading && !app ? (
        <div className="product-app-runtime-panel__state">
          <DotMatrixLoader size="small" />
          <span>{t('flexiblePanel.loading.productAppRuntime')}</span>
        </div>
      ) : null}
      {error ? (
        <div className="product-app-runtime-panel__state product-app-runtime-panel__state--error">
          <AlertTriangle size={26} />
          <p>{error}</p>
          <Button variant="secondary" size="small" onClick={() => void load()}>
            {t('flexiblePanel.actions.retry')}
          </Button>
        </div>
      ) : null}
      {app ? (
        <React.Suspense fallback={null}>
          <ProductAppRuntimeIframeHost
            key={runnerKey}
            app={app}
            route={route}
            tabId={tabId}
            sessionId={sessionId}
            scope={effectiveScope}
            workspacePath={effectiveWorkspacePath}
            runtimeContext={runtimeContext ?? productAppRuntime?.runtimeContext ?? null}
            productAppRuntime={productAppRuntime}
            onPreviewLoad={() => setPreviewReady(true)}
            onPreviewBootTimeout={handlePreviewBootTimeout}
          />
        </React.Suspense>
      ) : null}
      {app && (loading || !previewReady) ? (
        <div className="product-app-runtime-panel__updating" role="status">
          <DotMatrixLoader size="tiny" />
          <span>{t('flexiblePanel.loading.productAppRuntimeUpdating')}</span>
        </div>
      ) : null}
    </div>
  );
};

export default ProductAppRuntimePanel;
