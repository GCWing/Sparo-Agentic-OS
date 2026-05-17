/**
 * LiveAppRunner — sandboxed iframe that runs a compiled Live App.
 * Injects the bridge script (already in compiledHtml from Rust compiler)
 * and handles all postMessage RPC via useLiveAppBridge.
 */
import React, { useCallback, useRef } from 'react';
import type { LiveApp } from '@/infrastructure/api/service-api/LiveAppAPI';
import { useLiveAppBridge } from '../hooks/useLiveAppBridge';
import { useTheme } from '@/infrastructure/theme/hooks/useTheme';
import { useI18n } from '@/infrastructure/i18n';
import { buildLiveAppThemeVars } from '../buildLiveAppThemeVars';

interface LiveAppRunnerProps {
  app: LiveApp;
}

const LiveAppRunner: React.FC<LiveAppRunnerProps> = ({ app }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { theme } = useTheme();
  const { currentLanguage } = useI18n();
  useLiveAppBridge(iframeRef, app);

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
  }, [currentLanguage, theme]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={app.compiled_html}
      data-app-id={app.id}
      onLoad={pushInitialRuntimeState}
      sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
      style={{
        width: '100%',
        height: '100%',
        minWidth: 0,
        minHeight: 0,
        border: 'none',
        display: 'block',
        background: 'var(--ds-color-bg-app)',
      }}
      title={app.name}
    />
  );
};

export default LiveAppRunner;
