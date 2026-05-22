import type { RuntimeTaskOptions, RuntimePeriodicTaskOptions } from './AppRuntime';

export const runtimePolicy = {
  sessionPreloadRecent: {
    priority: 'idle',
    delayMs: 1500,
    idleTimeoutMs: 6000,
    slowMs: 2500,
    reason: 'startup-session-warmup',
  },
  sessionPreloadAgentic: {
    priority: 'idle',
    delayMs: 2500,
    idleTimeoutMs: 7000,
    slowMs: 2500,
    reason: 'startup-dispatcher-warmup',
  },
  liveAppRunningPoll: {
    priority: 'background',
    intervalMs: 15_000,
    initialDelayMs: 15_000,
    pauseWhenHidden: true,
    idleTimeoutMs: 5000,
    slowMs: 1000,
    reason: 'live-app-runtime-status',
  },
  fileWatchStart: {
    priority: 'background',
    delayMs: 250,
    idleTimeoutMs: 3000,
    slowMs: 1000,
    reason: 'file-explorer-visible-watch',
  },
  remoteConnectStatusPoll: {
    priority: 'background',
    intervalMs: 4000,
    runImmediately: true,
    pauseWhenHidden: true,
    idleTimeoutMs: 2000,
    slowMs: 1000,
    reason: 'remote-connect-status',
  },
  processingStatusCleanup: {
    priority: 'idle',
    intervalMs: 60_000,
    initialDelayMs: 60_000,
    pauseWhenHidden: true,
    idleTimeoutMs: 1000,
    reason: 'processing-status-cleanup',
  },
  cleanup: {
    priority: 'idle',
    intervalMs: 60_000,
    pauseWhenHidden: true,
    reason: 'runtime-cleanup',
  },
} satisfies Record<string, RuntimeTaskOptions | RuntimePeriodicTaskOptions>;
