import { useSyncExternalStore } from 'react';
import { configStartupStatusStore } from './ConfigStartupStatusStore';

export function useConfigStartupStatus() {
  return useSyncExternalStore(
    configStartupStatusStore.subscribe,
    configStartupStatusStore.getState,
    configStartupStatusStore.getState,
  );
}
