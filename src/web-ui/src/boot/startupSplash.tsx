let splashDismissed = false;
let splashMotionElement: HTMLElement | null = null;
let splashStartupComplete = false;
let splashDismissPending = false;
let splashStartupFallback: number | null = null;
let mainWindowShowPromise: Promise<void> | null = null;
let mainApplicationStartScheduled = false;
let mainApplicationStarted = false;

/**
 * Shares one native show request between the early splash and the React app.
 * A failed early request is cleared so the app-level fallback can retry it.
 */
export function requestMainWindowShow(): Promise<void> {
  if (!mainWindowShowPromise) {
    mainWindowShowPromise = import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke<void>('show_main_window'))
      .catch((error) => {
        mainWindowShowPromise = null;
        throw error;
      });
  }

  return mainWindowShowPromise;
}

function startMainApplication(): void {
  if (mainApplicationStarted) return;
  mainApplicationStarted = true;
  void import('../main');
}

function scheduleMainApplicationAfterSplashPaint(): void {
  if (mainApplicationStartScheduled) return;
  mainApplicationStartScheduled = true;

  window.requestAnimationFrame(() => {
    window.setTimeout(startMainApplication, 0);
  });
}

function finishInlineSplashDismissal(): void {
  if (splashDismissed) return;
  splashDismissed = true;
  const splash = document.getElementById('sparo-splash');
  if (!splash) return;
  splash.dataset.leaving = '1';

  window.setTimeout(() => {
    if (splashStartupFallback !== null) {
      window.clearTimeout(splashStartupFallback);
      splashStartupFallback = null;
    }
    splashMotionElement = null;
    splash.parentNode?.removeChild(splash);
  }, 400);
}

function handleSplashMotionMounted(): void {
  const splash = document.getElementById('sparo-splash');
  if (splash) splash.dataset.motionReady = '1';

  // The DOM is ready for the native window's first visible frame. The main
  // application reuses this request and retries with logging if it fails.
  void requestMainWindowShow().catch(() => {});
}

function handleSplashStartupComplete(): void {
  if (splashStartupComplete) return;
  splashStartupComplete = true;
  if (splashDismissPending) {
    finishInlineSplashDismissal();
    return;
  }
  if (splashMotionElement) splashMotionElement.dataset.motion = 'thinking';
  const splash = document.getElementById('sparo-splash');
  if (splash && !splashDismissed && splash.dataset.leaving !== '1') {
    splash.dataset.delayedLoader = '1';
  }
}

function mountStartupSplash(): void {
  const host = document.getElementById('sparo-splash-motion-root');
  if (!host || !host.isConnected || splashMotionElement) return;

  splashMotionElement = host;
  host.dataset.motion = 'startup';
  host.querySelector('.sparo-splash-mark__surface')?.addEventListener('animationend', (event) => {
    if ((event as AnimationEvent).animationName === 'sparo-splash-materialize') {
      handleSplashStartupComplete();
    }
  }, { once: true });

  handleSplashMotionMounted();

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.requestAnimationFrame(handleSplashStartupComplete);
    return;
  }

  // Prevent a stylesheet failure from holding the startup phase indefinitely.
  splashStartupFallback = window.setTimeout(handleSplashStartupComplete, 1500);
}

export function dismissInlineSplash(): void {
  if (splashDismissed || splashDismissPending) return;
  if (splashMotionElement && !splashStartupComplete) {
    splashDismissPending = true;
    return;
  }
  finishInlineSplashDismissal();
}

export function forceDismissInlineSplash(): void {
  finishInlineSplashDismissal();
}

const isAgentCompanionWindow =
  new URLSearchParams(window.location.search).get('sparoWindow') === 'agent-companion';

if (!isAgentCompanionWindow) {
  mountStartupSplash();
  scheduleMainApplicationAfterSplashPaint();
} else {
  startMainApplication();
}
