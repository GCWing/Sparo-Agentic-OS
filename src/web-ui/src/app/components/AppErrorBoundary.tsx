import { Component, ReactNode } from 'react';
import { Button, WindowControls } from '@/design-system';
import { createLogger } from '@/shared/utils/logger';
import { i18nService } from '@/infrastructure/i18n';
import { buildReactCrashLogPayload } from '@/shared/utils/reactProductionError';
import './AppErrorBoundary.scss';

const log = createLogger('AppErrorBoundary');

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: any;
  actionMessage?: string;
  isMaximized: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  private unlistenResized?: () => void;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, isMaximized: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, isMaximized: false };
  }

  componentDidMount() {
    void this.setupWindowStateListener();
  }

  componentWillUnmount() {
    this.unlistenResized?.();
  }

  componentDidCatch(error: Error, errorInfo: any) {
    this.setState({ error, errorInfo });
    void this.syncWindowState();
    // Log every boundary capture (do not share a session-wide flag with main.tsx:
    // a second distinct error would otherwise be suppressed).
    log.error(
      '[CRASH] React error boundary caught exception',
      buildReactCrashLogPayload(error, errorInfo)
    );
  }

  handleReload = () => {
    window.location.reload();
  };

  isTauriDesktop = () =>
    typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

  isMacOSDesktop = () =>
    this.isTauriDesktop() &&
    typeof navigator !== 'undefined' &&
    typeof navigator.platform === 'string' &&
    navigator.platform.toUpperCase().includes('MAC');

  setupWindowStateListener = async () => {
    if (!this.isTauriDesktop()) return;

    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();
      await this.syncWindowState();
      this.unlistenResized = await appWindow.onResized(() => {
        void this.syncWindowState();
      });
    } catch (error) {
      log.warn('Failed to setup crash page window controls', { error });
    }
  };

  syncWindowState = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const maximized = await getCurrentWindow().isMaximized();
      this.setState({ isMaximized: maximized });
    } catch {
      // Best-effort only: the crash page must keep rendering even if window APIs fail.
    }
  };

  handleMinimize = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().minimize();
    } catch (error) {
      log.warn('Failed to minimize crash page window', { error });
    }
  };

  handleMaximize = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();
      const maximized = await appWindow.isMaximized();
      if (maximized) {
        await appWindow.unmaximize();
      } else {
        await appWindow.maximize();
      }
      this.setState({ isMaximized: !maximized });
    } catch (error) {
      log.warn('Failed to toggle crash page window maximized state', { error });
    }
  };

  handleClose = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    } catch (error) {
      log.warn('Failed to close crash page window', { error });
    }
  };

  handleChromeMouseDown = (event: React.MouseEvent) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (!target || target.closest('.app-error-boundary__window-controls')) return;

    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().startDragging();
      } catch {
        // Dragging is a convenience; keep the recovery page quiet if unavailable.
      }
    })();
  };

  buildDiagnostics = () => {
    const error = this.state.error;
    const errorInfo = this.state.errorInfo;
    const lines = [
      'Sparo OS crash diagnostics',
      `Time: ${new Date().toISOString()}`,
      `URL: ${window.location.href}`,
      `User agent: ${navigator.userAgent}`,
      '',
      'Error:',
      error ? `${error.name}: ${error.message}` : i18nService.t('errors:boundary.unknown'),
    ];

    if (error?.stack) {
      lines.push('', 'Stack:', error.stack);
    }

    if (errorInfo?.componentStack) {
      lines.push('', 'Component stack:', errorInfo.componentStack);
    }

    return lines.join('\n');
  };

  handleCopyDiagnostics = async () => {
    const copiedLabel = i18nService.t('errors:boundary.actions.copied');
    const failedLabel = i18nService.t('errors:boundary.actions.copyFailed');

    try {
      const diagnostics = this.buildDiagnostics();
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(diagnostics);
      } else {
        const { systemAPI } = await import('@/infrastructure/api');
        await systemAPI.setClipboard(diagnostics);
      }
      this.setState({ actionMessage: copiedLabel });
    } catch (error) {
      log.warn('Failed to copy crash diagnostics', { error });
      this.setState({ actionMessage: failedLabel });
    }
  };

  handleOpenLogs = async () => {
    const openedLabel = i18nService.t('errors:boundary.actions.logsOpened');
    const failedLabel = i18nService.t('errors:boundary.actions.openLogsFailed');

    try {
      const { configAPI, workspaceAPI } = await import('@/infrastructure/api');
      const info = await configAPI.getRuntimeLoggingInfo();
      await workspaceAPI.revealInExplorer(info.sessionLogDir);
      this.setState({ actionMessage: openedLabel });
    } catch (error) {
      log.warn('Failed to open crash log directory', { error });
      this.setState({ actionMessage: failedLabel });
    }
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const title = i18nService.t('errors:boundary.title');
    const description = i18nService.t('errors:boundary.description');
    const errorSummaryTitle = i18nService.t('errors:boundary.sections.errorSummary');
    const reloadLabel = i18nService.t('errors:boundary.reload');
    const copyDiagnosticsLabel = i18nService.t('errors:boundary.actions.copyDiagnostics');
    const openLogsLabel = i18nService.t('errors:boundary.actions.openLogs');
    const technicalDetails = i18nService.t('errors:boundary.technicalDetails');
    const unknownError = i18nService.t('errors:boundary.unknown');
    const firstLine = this.state.error?.message?.split('\n')[0] ?? unknownError;
    const actionHint = i18nService.t('errors:boundary.actionHint');
    const diagnostics = this.buildDiagnostics();
    const showWindowControls = this.isTauriDesktop() && !this.isMacOSDesktop();

    return (
      <div className="app-error-boundary">
        {showWindowControls && (
          <div
            className="app-error-boundary__chrome"
            onMouseDown={this.handleChromeMouseDown}
            onDoubleClick={this.handleMaximize}
          >
            <div className="app-error-boundary__window-controls">
              <WindowControls
                onMinimize={() => void this.handleMinimize()}
                onMaximize={() => void this.handleMaximize()}
                onClose={() => void this.handleClose()}
                isMaximized={this.state.isMaximized}
                minimizeLabel={i18nService.t('components:windowControls.minimize')}
                maximizeLabel={i18nService.t('components:windowControls.maximize')}
                restoreLabel={i18nService.t('components:windowControls.restore')}
                closeLabel={i18nService.t('components:windowControls.close')}
              />
            </div>
          </div>
        )}
        <main className="app-error-boundary__content">
          <header className="app-error-boundary__header">
            <p className="app-error-boundary__eyebrow">Sparo OS</p>
            <h1 className="app-error-boundary__title">{title}</h1>
            <p className="app-error-boundary__description">{description}</p>
          </header>

          <section className="app-error-boundary__actions">
            <p className="app-error-boundary__hint">{actionHint}</p>
            <div className="app-error-boundary__button-row">
              <Button variant="primary" size="small" onClick={this.handleReload}>
                {reloadLabel}
              </Button>
              <Button
                variant="ghost"
                size="small"
                onClick={() => void this.handleCopyDiagnostics()}
              >
                {copyDiagnosticsLabel}
              </Button>
              <Button
                variant="ghost"
                size="small"
                onClick={() => void this.handleOpenLogs()}
              >
                {openLogsLabel}
              </Button>
            </div>
            {this.state.actionMessage && (
              <p className="app-error-boundary__action-message">
                {this.state.actionMessage}
              </p>
            )}
          </section>

          <section className="app-error-boundary__diagnostics">
            <h2 className="app-error-boundary__section-title">{errorSummaryTitle}</h2>
            <p className="app-error-boundary__summary">{firstLine}</p>
            <details className="app-error-boundary__details">
              <summary>{technicalDetails}</summary>
              <pre>{diagnostics}</pre>
            </details>
          </section>
        </main>
      </div>
    );
  }
}

export default AppErrorBoundary;
