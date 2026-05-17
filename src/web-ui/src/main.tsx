import ReactDOM from "react-dom/client";
import { installGlobalSurfaceEscapeToHome } from "./app/globalOverlayEscape";
import App from "./app/App";
import AgentCompanionDesktopPet from "./app/components/AgentCompanionDesktopPet/AgentCompanionDesktopPet";

installGlobalSurfaceEscapeToHome();
import AppErrorBoundary from "./app/components/AppErrorBoundary";
import { WorkspaceProvider } from "./infrastructure/contexts/WorkspaceProvider";
import "./app/styles/index.scss";

// Monaco's `editor.main.css` is no longer imported here. It's now imported
// from `MonacoInitManager.ts`, which is itself dynamically imported inside
// `initializeAfterRender()` — so the shell paints first and Monaco CSS only
// loads when the editor is about to be used.

// Font: Noto Sans SC is loaded via a <link> tag in index.html.
// File path: public/fonts/fonts.css, served as /fonts/fonts.css.

import { initializeAllTools } from "./tools";
import { initContextMenuSystem } from "./shared/context-menu-system";
import { getMonacoPath, getMonacoWorkerPath, logMonacoResourceCheck } from './tools/editor/utils/monacoPathHelper';
import { bootstrapLogger, createLogger, initLogger } from './shared/utils/logger';
import { initBootStageBridge } from './boot/bootStage';
import {
  buildReactCrashLogPayload,
  isMinifiedReactErrorMessage,
} from './shared/utils/reactProductionError';

// Install console forwarding before app startup so early console output is persisted too.
bootstrapLogger();

const log = createLogger('App');

/** Dedupe only for white-screen heuristic (empty #root), not for Error Boundary logs. */
const WHITE_SCREEN_LOGGED_FLAG = '__bitfun_white_screen_crash_logged__';
function hasLoggedWhiteScreenCrash(): boolean {
  return Boolean((window as any)[WHITE_SCREEN_LOGGED_FLAG]);
}
function markWhiteScreenCrashLogged(): void {
  (window as any)[WHITE_SCREEN_LOGGED_FLAG] = true;
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  return { value: String(err) };
}

function isRootEmpty(): boolean {
  const root = document.getElementById('root');
  if (!root) {
    return true;
  }
  return root.childElementCount === 0;
}

function registerGlobalErrorHandlers() {
  const flag = '__bitfun_global_error_handlers_registered__';
  const w = window as any;
  if (w[flag]) {
    return;
  }
  w[flag] = true;

  const scheduleCrashLog = (payload: { location: string; message: string; data?: Record<string, unknown> }) => {
    // Only persist when it looks like a real "white screen"/startup crash.
    queueMicrotask(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (isRootEmpty() && !hasLoggedWhiteScreenCrash()) {
            markWhiteScreenCrashLogged();
            log.error('[CRASH] Application crashed', {
              location: payload.location,
              message: payload.message,
              ...payload.data,
            });
          }
        });
      });
    });
  };

  window.addEventListener(
    'error',
    (event: Event) => {
      if (event instanceof ErrorEvent) {
        const msg = event.message || '';
        // Minified React errors often reach window.error even when #root is not empty;
        // always persist so production builds get react.dev/errors/{code} in webview.log.
        if (isMinifiedReactErrorMessage(msg)) {
          const err =
            event.error instanceof Error ? event.error : new Error(msg);
          log.error('[CRASH] window:error (minified React)', {
            location: 'window:error',
            ...buildReactCrashLogPayload(err),
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
          });
        }
        scheduleCrashLog({
          location: 'window:error',
          message: msg || 'window error',
          data: {
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            error: serializeError(event.error),
          },
        });
        return;
      }

    // Resource load errors rarely cause a white screen; log only if root is empty.
      const target = event.target as any;
      scheduleCrashLog({
        location: 'window:resource-error',
        message: 'resource load error',
        data: {
          tagName: target?.tagName,
          src: target?.src,
          href: target?.href,
        },
      });
    },
    true
  );

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const msg =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : '';
    if (isMinifiedReactErrorMessage(msg)) {
      const err = reason instanceof Error ? reason : new Error(msg);
      log.error('[CRASH] unhandledrejection (minified React)', {
        location: 'window:unhandledrejection',
        ...buildReactCrashLogPayload(err),
      });
    }
    scheduleCrashLog({
      location: 'window:unhandledrejection',
      message: 'unhandled rejection',
      data: {
        reason: serializeError(event.reason),
      },
    });
  });
}

registerGlobalErrorHandlers();

function AppErrorBoundaryPreviewTrigger() {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('previewAppError') === '1') {
    throw new Error('Preview crash for the Sparo OS app error boundary.');
  }

  return null;
}

// NOTE: We do not intercept Tab globally. Tab is the standard accessibility
// key for focus traversal; suppressing it breaks keyboard navigation, screen
// readers, and all unit tests using `userEvent.tab()`. Container components
// that need a "trap" should use a roving-tabindex pattern instead.

// Monaco Editor loader paths and worker map. The actual `loader.config(...)`
// call lives inside `MonacoInitManager` so we don't import `@monaco-editor/react`
// at the entry — keeps the entry chunk smaller and lets the splash paint sooner.
const isDev = import.meta.env.DEV;
const monacoPath = getMonacoPath();
(window as any).__SPARO_MONACO_VS_PATH__ = monacoPath;

// Debug: check resource availability in production.
if (!isDev) {
  // Delay checks to avoid blocking startup.
  setTimeout(() => {
    logMonacoResourceCheck().catch(err => {
      log.error('Monaco resource check failed', err);
    });
  }, 2000);
}

// Optimization: Monaco Editor worker mapping.
const MONACO_WORKER_MAP: Record<string, string> = {
  json: 'language/json/jsonWorker.js',
  css: 'language/css/cssWorker.js',
  scss: 'language/css/cssWorker.js',
  less: 'language/css/cssWorker.js',
  html: 'language/html/htmlWorker.js',
  handlebars: 'language/html/htmlWorker.js',
  razor: 'language/html/htmlWorker.js',
  typescript: 'language/typescript/tsWorker.js',
  javascript: 'language/typescript/tsWorker.js',
};

const DEFAULT_WORKER = 'base/worker/workerMain.js';

(window as any).MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    const workerFile = MONACO_WORKER_MAP[label] || DEFAULT_WORKER;
    const workerPath = getMonacoWorkerPath(workerFile);
    
    return new Worker(workerPath, {
      type: 'classic',
      name: `monaco-${label}-worker`
    });
  }
};

/** Logger, theme, and minimal deps — must finish before first React paint (F5 / webview reload does not re-run Tauri init script). */
async function initializeBeforeRender(): Promise<void> {
  // Start the boot-stage bridge as early as possible so we never miss the
  // backend's `WindowReady` or `GlobalReady` transitions.
  void initBootStageBridge();

  await initLogger();

  const { initializeFrontendLogLevelSync } = await import('./infrastructure/config/services/FrontendLogLevelSync');
  await initializeFrontendLogLevelSync();

  log.debug('Monaco loader configured', { vs: monacoPath, isDev });
  log.info('Initializing BitFun');

  const { registerDefaultContextTypes } = await import('./shared/context-system/core/registerDefaultTypes');
  registerDefaultContextTypes();

  const { initRecommendationProviders } = await import('./flow_chat/components/smart-recommendations');
  initRecommendationProviders();

  const { themeService } = await import('./infrastructure/theme');
  await themeService.initialize();
  log.info('Theme system initialized');
}

/** Rest of startup runs after the shell is visible so refresh latency stays reasonable. */
async function initializeAfterRender(): Promise<void> {
  const { fontPreferenceService } = await import('./infrastructure/font-preference');
  await fontPreferenceService.initialize();
  log.info('Font preference initialized at startup');

  const { configManager } = await import('./infrastructure/config');
  await configManager.getConfig('editor');
  log.info('Editor configuration preloaded');

  const initResults = await Promise.allSettled([
    initializeAllTools(),
    (async () => {
      initContextMenuSystem({
        registerBuiltinCommands: true,
        registerBuiltinProviders: true,
        debug: false,
      });

      const { registerNotificationContextMenu } = await import('./shared/notification-system');
      registerNotificationContextMenu();
    })(),
    (async () => {
      const { MonacoManager } = await import('./tools/editor');
      await MonacoManager.initialize();

      const { monacoThemeSync } = await import('./infrastructure/theme/integrations/MonacoThemeSync');
      await monacoThemeSync.initialize();
      log.info('Monaco theme sync initialized');
    })(),
  ]);

  initResults.forEach((result, index) => {
    const names = ['Tools', 'ContextMenu', 'Editors'];
    if (result.status === 'rejected') {
      log.warn('Initialization failed', { module: names[index], error: result.reason });
    }
  });

  log.info('BitFun core systems initialized successfully');
}

/**
 * Hide and remove the inline splash defined in `index.html`.
 *
 * The splash stays up until the backend reports `workspaceReady` (or a
 * `degraded` boot, so the recovery panel becomes interactable) — the
 * agent-companion window has no splash so this is a no-op there.
 *
 * Idempotent: safe to call from multiple subscribers / safety timers.
 */
let splashDismissed = false;
function dismissInlineSplash(): void {
  if (splashDismissed) return;
  splashDismissed = true;
  const splash = document.getElementById('sparo-splash');
  if (!splash) return;
  splash.dataset.leaving = '1';
  // Match the 360ms CSS opacity transition; remove afterwards so it doesn't
  // intercept events even though it already has `pointer-events: none`.
  window.setTimeout(() => {
    splash.parentNode?.removeChild(splash);
  }, 400);
}

/**
 * Subscribe to the boot-stage bridge and dismiss the splash on the first
 * stage that means the shell can take over (`workspaceReady`) — or
 * `degraded`, so the user can see the recovery panel rather than staring
 * at a quietly breathing logo while the backend is unrecoverable.
 *
 * Safety net: hard timeout at 8s so a totally silent backend can't leave
 * the user trapped behind the splash forever.
 */
function wireSplashDismissalToBootStage(): void {
  // Lazy import keeps `boot/bootStage` out of the entry chunk's
  // synchronous graph.
  void import('./boot/bootStage').then(({ subscribeBootStage }) => {
    const unsubscribe = subscribeBootStage(stage => {
      if (stage.kind === 'workspaceReady' || stage.kind === 'degraded') {
        dismissInlineSplash();
        unsubscribe();
      }
    });
  });

  window.setTimeout(() => {
    if (!splashDismissed) {
      log.warn('Splash watchdog firing — backend never reported workspaceReady');
      dismissInlineSplash();
    }
  }, 8000);
}

async function startApplication(): Promise<void> {
  try {
    await initializeBeforeRender();
  } catch (error) {
    log.error('Failed to initialize BitFun (pre-render)', error);
  }

  // I18n Provider.
  const { I18nProvider } = await import('./infrastructure/i18n');

  const isAgentCompanionWindow = new URLSearchParams(window.location.search)
    .get('sparoWindow') === 'agent-companion';

  if (isAgentCompanionWindow) {
    ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
      <AppErrorBoundary>
        <AppErrorBoundaryPreviewTrigger />
        <I18nProvider>
          <AgentCompanionDesktopPet />
        </I18nProvider>
      </AppErrorBoundary>
    );
    // Agent-companion window has no splash; nothing else to do.
    return;
  }

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <AppErrorBoundary>
      <AppErrorBoundaryPreviewTrigger />
      <I18nProvider>
        <WorkspaceProvider>
          <App />
        </WorkspaceProvider>
      </I18nProvider>
    </AppErrorBoundary>
  );

  // Splash stays up until the backend reports `workspaceReady` (or `degraded`).
  // Wiring happens after React is rendering so the listener can't race with
  // the bridge's initial replay.
  wireSplashDismissalToBootStage();

  try {
    await initializeAfterRender();
  } catch (error) {
    log.error('Failed to complete post-render initialization', error);
  }
}

void startApplication();
