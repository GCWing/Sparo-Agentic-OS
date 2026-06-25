/**
 * LiveAppRunner — sandboxed iframe that runs a compiled Live App.
 * Injects the bridge script (already in compiledHtml from Rust compiler)
 * and handles all postMessage RPC via useLiveAppBridge.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import type { LiveApp } from '@/infrastructure/api/service-api/LiveAppAPI';
import type { LiveAppWorkbenchSessionMetadata } from '@/shared/types/session-history';
import { useLiveAppBridge } from '../hooks/useLiveAppBridge';
import { useTheme } from '@/infrastructure/theme/hooks/useTheme';
import { useI18n } from '@/infrastructure/i18n';
import { buildLiveAppThemeVars } from '../buildLiveAppThemeVars';
import { resolveLiveAppMeta } from '../liveAppI18n';
import type { PreviewElementInspectorPayload } from '../previewSelectionContext';
import {
  appScopeFromWorkspacePath,
  normalizeAppScope,
  systemAppScope,
  type AppScope,
  workspacePathFromAppScope,
} from '@/shared/types/app-scope';

interface LiveAppRunnerProps {
  app: LiveApp;
  route?: string;
  tabId?: string;
  sessionId?: string;
  scope?: AppScope | null;
  workspacePath?: string;
  liveAppWorkbench?: LiveAppWorkbenchSessionMetadata;
  elementInspectorEnabled?: boolean;
  onElementInspectorHover?: (payload: PreviewElementInspectorPayload | null) => void;
  onElementInspectorSelect?: (payload: PreviewElementInspectorPayload) => void;
  onElementInspectorExit?: () => void;
}

const LiveAppRunner: React.FC<LiveAppRunnerProps> = ({
  app,
  route,
  tabId,
  sessionId,
  scope,
  workspacePath,
  liveAppWorkbench,
  elementInspectorEnabled = false,
  onElementInspectorHover,
  onElementInspectorSelect,
  onElementInspectorExit,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { theme } = useTheme();
  const { currentLanguage } = useI18n();
  const displayMeta = resolveLiveAppMeta(app, currentLanguage);
  const locksViewportScroll = app.id === 'builtin-spark-board';
  const normalizedRoute = useMemo(() => route?.trim() || '/', [route]);
  const effectiveScope = useMemo(
    () => normalizeAppScope(
      scope ||
      liveAppWorkbench?.scope ||
      appScopeFromWorkspacePath(workspacePath) ||
      systemAppScope(),
    ),
    [liveAppWorkbench?.scope, scope, workspacePath],
  );
  const effectiveWorkspacePath = workspacePathFromAppScope(effectiveScope);
  useLiveAppBridge(iframeRef, app, { scope: effectiveScope });

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
          entityId: liveAppWorkbench?.entityId || null,
          workbench: liveAppWorkbench
            ? {
              appId: liveAppWorkbench.appId,
              appName: liveAppWorkbench.appName,
              profile: liveAppWorkbench.profile,
              entityId: liveAppWorkbench.entityId,
              workspacePath: liveAppWorkbench.workspacePath,
              scope: liveAppWorkbench.scope,
              interactionTitle: liveAppWorkbench.interactionTitle,
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
    liveAppWorkbench,
    normalizedRoute,
    sessionId,
    tabId,
  ]);

  const pushInitialRuntimeState = useCallback(() => {
    const target = iframeRef.current?.contentWindow;
    if (!target) return;

    const themePayload = buildLiveAppThemeVars(theme);
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

export default LiveAppRunner;
