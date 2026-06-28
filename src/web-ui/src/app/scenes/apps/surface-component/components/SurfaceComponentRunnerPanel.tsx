import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button, DotMatrixLoader } from '@/design-system';
import { surfaceComponentAPI } from '@/infrastructure/api/service-api/SurfaceComponentAPI';
import type { SurfaceComponent } from '@/infrastructure/api/service-api/SurfaceComponentAPI';
import { useTheme } from '@/infrastructure/theme/hooks/useTheme';
import { useI18n } from '@/infrastructure/i18n';
import { createLogger } from '@/shared/utils/logger';
import type { SurfaceComponentWorkbenchSessionMetadata } from '@/shared/types/session-history';
import {
  appScopeFromWorkspacePath,
  appScopeIdentity,
  normalizeAppScope,
  systemAppScope,
  type AppScope,
  workspacePathFromAppScope,
} from '@/shared/types/app-scope';
import { useSurfaceComponentStore } from '../surfaceComponentStore';
import SurfaceComponentRunner from './SurfaceComponentRunner';
import './SurfaceComponentRunnerPanel.scss';

const log = createLogger('SurfaceComponentRunnerPanel');

interface SurfaceComponentRunnerPanelProps {
  appId?: string;
  scope?: AppScope | null;
  workspacePath?: string;
  route?: string;
  tabId?: string;
  sessionId?: string;
  surfaceComponentWorkbench?: SurfaceComponentWorkbenchSessionMetadata;
}

const SurfaceComponentRunnerPanel: React.FC<SurfaceComponentRunnerPanelProps> = ({
  appId,
  scope,
  workspacePath,
  route,
  tabId,
  sessionId,
  surfaceComponentWorkbench,
}) => {
  const { themeType } = useTheme();
  const { t } = useI18n('components');
  const openApp = useSurfaceComponentStore((state) => state.openApp);
  const closeApp = useSurfaceComponentStore((state) => state.closeApp);
  const setRecentAppIds = useSurfaceComponentStore((state) => state.setRecentAppIds);
  const [app, setApp] = useState<SurfaceComponent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const effectiveScope = useMemo(
    () => normalizeAppScope(
      scope ||
      surfaceComponentWorkbench?.scope ||
      appScopeFromWorkspacePath(workspacePath) ||
      systemAppScope(),
    ),
    [surfaceComponentWorkbench?.scope, scope, workspacePath],
  );
  const effectiveWorkspacePath = workspacePathFromAppScope(effectiveScope);

  useEffect(() => {
    if (!appId) return;
    openApp(appId);
    void surfaceComponentAPI.recordRecentSurfaceComponent(appId)
      .then(setRecentAppIds)
      .catch((error) => log.warn('Failed to persist recent Product App', { appId, error }));
    return () => closeApp(appId);
  }, [appId, closeApp, openApp, setRecentAppIds]);

  const load = useCallback(async () => {
    if (!appId) return;
    setLoading(true);
    try {
      const loaded = await surfaceComponentAPI.getSurfaceComponent(
        appId,
        themeType ?? 'dark',
        effectiveWorkspacePath,
      );
      setApp(loaded);
      setError(null);
    } catch (error) {
      log.error('Failed to load Product App runner panel', { appId, error });
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [appId, effectiveWorkspacePath, themeType]);

  useEffect(() => {
    void load();
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

  if (!appId) {
    return (
      <div
        className="surface-component-runner-panel surface-component-runner-panel--empty"
        data-testid="surface-component-runner-panel"
        data-app-id={appId}
      >
        <AlertTriangle size={24} />
        <p>{t('flexiblePanel.errors.surfaceComponentRunnerMissingAppId')}</p>
      </div>
    );
  }

  return (
    <div
      className="surface-component-runner-panel"
      data-testid="surface-component-runner-panel"
      data-app-id={appId}
      data-route={route || '/'}
    >
      {loading && !app ? (
        <div className="surface-component-runner-panel__state">
          <DotMatrixLoader size="small" />
          <span>{t('flexiblePanel.loading.surfaceComponentRunner')}</span>
        </div>
      ) : null}
      {error ? (
        <div className="surface-component-runner-panel__state surface-component-runner-panel__state--error">
          <AlertTriangle size={26} />
          <p>{error}</p>
          <Button variant="secondary" size="small" onClick={() => void load()}>
            {t('flexiblePanel.actions.retry')}
          </Button>
        </div>
      ) : null}
      {app ? (
        <React.Suspense fallback={null}>
          <SurfaceComponentRunner
            key={runnerKey}
            app={app}
            route={route}
            tabId={tabId}
            sessionId={sessionId}
            scope={effectiveScope}
            workspacePath={effectiveWorkspacePath}
            surfaceComponentWorkbench={surfaceComponentWorkbench}
          />
        </React.Suspense>
      ) : null}
      {loading && app ? (
        <div className="surface-component-runner-panel__updating" role="status">
          <DotMatrixLoader size="tiny" />
          <span>{t('flexiblePanel.loading.surfaceComponentRunnerUpdating')}</span>
        </div>
      ) : null}
    </div>
  );
};

export default SurfaceComponentRunnerPanel;
