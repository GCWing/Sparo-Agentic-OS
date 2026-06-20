/**
 * LiveAppRunner — sandboxed iframe that runs a compiled Live App.
 * Injects the bridge script (already in compiledHtml from Rust compiler)
 * and handles all postMessage RPC via useLiveAppBridge.
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import type { LiveApp } from '@/infrastructure/api/service-api/LiveAppAPI';
import type { LiveAppWorkbenchSessionMetadata } from '@/shared/types/session-history';
import { useLiveAppBridge } from '../hooks/useLiveAppBridge';
import { useTheme } from '@/infrastructure/theme/hooks/useTheme';
import { useI18n } from '@/infrastructure/i18n';
import { useLastUsedWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { buildLiveAppThemeVars } from '../buildLiveAppThemeVars';
import { resolveLiveAppMeta } from '../liveAppI18n';

interface LiveAppRunnerProps {
  app: LiveApp;
  route?: string;
  tabId?: string;
  sessionId?: string;
  workspacePath?: string;
  liveAppWorkbench?: LiveAppWorkbenchSessionMetadata;
}

const LiveAppRunner: React.FC<LiveAppRunnerProps> = ({
  app,
  route,
  tabId,
  sessionId,
  workspacePath,
  liveAppWorkbench,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { theme } = useTheme();
  const { currentLanguage } = useI18n();
  const { workspacePath: hostWorkspacePath } = useLastUsedWorkspace();
  const displayMeta = resolveLiveAppMeta(app, currentLanguage);
  const locksViewportScroll = app.id === 'builtin-spark-board';
  const normalizedRoute = useMemo(() => route?.trim() || '/', [route]);
  const effectiveWorkspacePath = workspacePath || liveAppWorkbench?.workspacePath || hostWorkspacePath || undefined;
  useLiveAppBridge(iframeRef, app, { workspacePath: effectiveWorkspacePath });

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
          entityId: liveAppWorkbench?.entityId || null,
          workbench: liveAppWorkbench
            ? {
              appId: liveAppWorkbench.appId,
              appName: liveAppWorkbench.appName,
              profile: liveAppWorkbench.profile,
              entityId: liveAppWorkbench.entityId,
              workspacePath: liveAppWorkbench.workspacePath,
              interactionTitle: liveAppWorkbench.interactionTitle,
            }
            : null,
        },
      },
      '*',
    );
  }, [app.id, displayMeta.name, effectiveWorkspacePath, liveAppWorkbench, normalizedRoute, sessionId, tabId]);

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
  }, [currentLanguage, pushWorkbenchContext, theme]);

  useEffect(() => {
    pushWorkbenchContext();
  }, [pushWorkbenchContext]);

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
