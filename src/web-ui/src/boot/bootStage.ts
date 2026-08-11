/**
 * BootStage protocol — the single source of truth for application boot state.
 *
 * Mirrors `bootstrap::BootStage` in the Rust desktop crate. The backend pushes
 * each transition via the `boot://stage` Tauri event. The frontend listens
 * here, exposes the current stage as React state, and uses it to decide when
 * to render the main `<App />`.
 *
 * Backend readiness is immediate, while the splash handoff may wait for the
 * finite brand reveal to resolve so it never cuts away mid-animation.
 */

import { createLogger } from '@/shared/utils/logger';
import { isTauriRuntime } from '@/infrastructure/runtime';

const log = createLogger('BootStage');

export type BootStage =
  | { kind: 'preWindow' }
  | { kind: 'windowReady' }
  | { kind: 'globalReady' }
  | { kind: 'workspaceReady'; path: string | null }
  | { kind: 'degraded'; stage: string; error: string };

export const BOOT_STAGE_EVENT = 'boot://stage';

export type BootStageListener = (stage: BootStage) => void;

let cached: BootStage | null = null;
const listeners = new Set<BootStageListener>();
let initPromise: Promise<void> | null = null;

function emit(stage: BootStage): void {
  cached = stage;
  for (const listener of listeners) {
    try {
      listener(stage);
    } catch (error) {
      log.warn('Boot stage listener threw', { error });
    }
  }
}

/** Wire the Tauri event listener once. Safe to call repeatedly. */
export function initBootStageBridge(): Promise<void> {
  if (initPromise) return initPromise;
  if (!isTauriRuntime()) {
    // Browser preview (Vite preview / Storybook): synthesise a ready stage so
    // <App /> mounts straight away.
    emit({ kind: 'workspaceReady', path: null });
    initPromise = Promise.resolve();
    return initPromise;
  }
  initPromise = (async () => {
    try {
      const [{ invoke }, { listen }] = await Promise.all([
        import('@tauri-apps/api/core'),
        import('@tauri-apps/api/event'),
      ]);

      // Subscribe BEFORE the initial query so we never miss a transition that
      // happens between the query and the subscription.
      await listen<BootStage>(BOOT_STAGE_EVENT, event => {
        log.debug('Boot stage event', { stage: event.payload });
        emit(event.payload);
      });

      try {
        const initial = await invoke<BootStage>('get_boot_stage');
        log.debug('Initial boot stage', { stage: initial });
        emit(initial);
      } catch (error) {
        log.warn('Failed to read initial boot stage; relying on events', { error });
      }
    } catch (error) {
      log.error('Failed to initialize boot-stage bridge', { error });
    }
  })();
  return initPromise;
}

export function getBootStage(): BootStage | null {
  return cached;
}

export function subscribeBootStage(listener: BootStageListener): () => void {
  listeners.add(listener);
  if (cached) {
    try {
      listener(cached);
    } catch (error) {
      log.warn('Boot stage listener threw during initial replay', { error });
    }
  }
  return () => {
    listeners.delete(listener);
  };
}

export function isAppReady(stage: BootStage | null): boolean {
  if (!stage) return false;
  return stage.kind === 'workspaceReady';
}

export function isDegraded(stage: BootStage | null): stage is Extract<BootStage, { kind: 'degraded' }> {
  return stage?.kind === 'degraded';
}
