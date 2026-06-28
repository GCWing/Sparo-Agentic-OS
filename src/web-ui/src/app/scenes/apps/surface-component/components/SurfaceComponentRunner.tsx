/**
 * SurfaceComponentRunner — sandboxed iframe that runs a compiled Product App.
 * Injects the bridge script (already in compiledHtml from Rust compiler)
 * and handles all postMessage RPC via useSurfaceComponentBridge.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import type { SurfaceComponent } from '@/infrastructure/api/service-api/SurfaceComponentAPI';
import type { SurfaceComponentWorkbenchSessionMetadata } from '@/shared/types/session-history';
import { useSurfaceComponentBridge } from '../hooks/useSurfaceComponentBridge';
import { useTheme } from '@/infrastructure/theme/hooks/useTheme';
import { useI18n } from '@/infrastructure/i18n';
import { buildSurfaceComponentThemeVars } from '../buildSurfaceComponentThemeVars';
import { resolveSurfaceComponentMeta } from '../surfaceComponentI18n';
import type { PreviewElementInspectorPayload } from '../previewSelectionContext';
import {
  appScopeFromWorkspacePath,
  normalizeAppScope,
  systemAppScope,
  type AppScope,
  workspacePathFromAppScope,
} from '@/shared/types/app-scope';

interface SurfaceComponentRunnerProps {
  app: SurfaceComponent;
  route?: string;
  tabId?: string;
  sessionId?: string;
  scope?: AppScope | null;
  workspacePath?: string;
  surfaceComponentWorkbench?: SurfaceComponentWorkbenchSessionMetadata;
  elementInspectorEnabled?: boolean;
  onElementInspectorHover?: (payload: PreviewElementInspectorPayload | null) => void;
  onElementInspectorSelect?: (payload: PreviewElementInspectorPayload) => void;
  onElementInspectorExit?: () => void;
}

const SurfaceComponentRunner: React.FC<SurfaceComponentRunnerProps> = ({
  app,
  route,
  tabId,
  sessionId,
  scope,
  workspacePath,
  surfaceComponentWorkbench,
  elementInspectorEnabled = false,
  onElementInspectorHover,
  onElementInspectorSelect,
  onElementInspectorExit,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { theme } = useTheme();
  const { currentLanguage } = useI18n();
  const displayMeta = resolveSurfaceComponentMeta(app, currentLanguage);
  const locksViewportScroll = app.id === 'builtin-spark-board';
  const normalizedRoute = useMemo(() => route?.trim() || '/', [route]);
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
  useSurfaceComponentBridge(iframeRef, app, { scope: effectiveScope });

  const pushElementInspectorState = useCallback(() => {
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    target.postMessage(
      {
        type: 'sparo:event',
        event: 'previewElementInspectorSetEnabled',
        payload: {
          appId: app.id,
          route: normalizedRoute,
          enabled: elementInspectorEnabled,
        },
      },
      '*',
    );
  }, [app.id, elementInspectorEnabled, normalizedRoute]);

  const pushWorkbenchContext = useCallback(() => {
    const target = iframeRef.current?.contentWindow;
    if (!target) return;

    target.postMessage(
      {
        type: 'sparo:event',
        event: 'workbenchRouteChange',
        payload: {
          appId: app.id,
          appName: displayMeta.name,
          route: normalizedRoute,
          tabId,
          sessionId,
          workspacePath: effectiveWorkspacePath || null,
          scope: effectiveScope,
          entityId: surfaceComponentWorkbench?.entityId || null,
          workbench: surfaceComponentWorkbench
            ? {
              appId: surfaceComponentWorkbench.appId,
              appName: surfaceComponentWorkbench.appName,
              profile: surfaceComponentWorkbench.profile,
              entityId: surfaceComponentWorkbench.entityId,
              workspacePath: surfaceComponentWorkbench.workspacePath,
              scope: surfaceComponentWorkbench.scope,
              interactionTitle: surfaceComponentWorkbench.interactionTitle,
            }
            : null,
        },
      },
      '*',
    );
  }, [
    app.id,
    displayMeta.name,
    effectiveScope,
    effectiveWorkspacePath,
    surfaceComponentWorkbench,
    normalizedRoute,
    sessionId,
    tabId,
  ]);

  const pushInitialRuntimeState = useCallback(() => {
    const target = iframeRef.current?.contentWindow;
    if (!target) return;

    const themePayload = buildSurfaceComponentThemeVars(theme);
    if (themePayload) {
      target.postMessage({ type: 'sparo:event', event: 'themeChange', payload: themePayload }, '*');
    }
    if (currentLanguage) {
      target.postMessage(
        { type: 'sparo:event', event: 'localeChange', payload: { locale: currentLanguage } },
        '*',
      );
    }
    pushWorkbenchContext();
    pushElementInspectorState();
  }, [currentLanguage, pushElementInspectorState, pushWorkbenchContext, theme]);

  useEffect(() => {
    pushWorkbenchContext();
  }, [pushWorkbenchContext]);

  useEffect(() => {
    pushElementInspectorState();
  }, [pushElementInspectorState]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as {
        type?: string;
        appId?: string;
        route?: string;
        event?: string;
        payload?: PreviewElementInspectorPayload;
      };
      if (data?.type !== 'sparo:preview-element-inspector') return;
      if (data.appId && data.appId !== app.id) return;

      if (data.event === 'hover') {
        onElementInspectorHover?.(data.payload ?? null);
      } else if (data.event === 'hover-cleared') {
        onElementInspectorHover?.(null);
      } else if (data.event === 'selected' && data.payload?.element) {
        onElementInspectorSelect?.({ ...data.payload, route: data.route || data.payload.route || normalizedRoute });
      } else if (data.event === 'disabled') {
        onElementInspectorHover?.(null);
        onElementInspectorExit?.();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [app.id, normalizedRoute, onElementInspectorExit, onElementInspectorHover, onElementInspectorSelect]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={app.compiled_html}
      data-app-id={app.id}
      data-route={normalizedRoute}
      onLoad={pushInitialRuntimeState}
      sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
      scrolling={locksViewportScroll ? 'no' : undefined}
      style={{
        width: '100%',
        height: '100%',
        minWidth: 0,
        minHeight: 0,
        border: 'none',
        display: 'block',
        overflow: locksViewportScroll ? 'hidden' : undefined,
        overscrollBehavior: locksViewportScroll ? 'none' : undefined,
        background: 'var(--ds-color-bg-app)',
      }}
      title={displayMeta.name}
    />
  );
};

export default SurfaceComponentRunner;
