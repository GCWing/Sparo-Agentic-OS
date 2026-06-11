/**
 * useLiveAppCatalogSync — keeps Live App catalog and runtime state in sync.
 */
import { useCallback, useEffect } from 'react';
import { api } from '@/infrastructure/api/service-api/ApiClient';
import { liveAppAPI } from '@/infrastructure/api/service-api/LiveAppAPI';
import { appRuntime, runtimePolicy } from '@/infrastructure/app-runtime';
import { requestWorkRefresh } from '@/app/agentic-os/work/data/workStore';
import { createLogger } from '@/shared/utils/logger';
import { useLiveAppStore } from '../liveAppStore';

const log = createLogger('useLiveAppCatalogSync');

export function useLiveAppCatalogSync() {
  const setApps = useLiveAppStore((state) => state.setApps);
  const setLoading = useLiveAppStore((state) => state.setLoading);
  const setRuntimeStatus = useLiveAppStore((state) => state.setRuntimeStatus);
  const setRunningWorkerIds = useLiveAppStore((state) => state.setRunningWorkerIds);
  const markWorkerRunning = useLiveAppStore((state) => state.markWorkerRunning);
  const markWorkerStopped = useLiveAppStore((state) => state.markWorkerStopped);
  const bindSessionApp = useLiveAppStore((state) => state.bindSessionApp);

  const refreshApps = useCallback(async () => {
    setLoading(true);
    try {
      const apps = await liveAppAPI.listLiveApps();
      setApps(apps);
    } catch (error) {
      log.error('Failed to load live apps', error);
    } finally {
      setLoading(false);
    }
  }, [setApps, setLoading]);

  const refreshRunningWorkers = useCallback(async () => {
    try {
      const running = await liveAppAPI.workerListRunning();
      setRunningWorkerIds(running);
    } catch (error) {
      log.error('Failed to load running live app workers', error);
    }
  }, [setRunningWorkerIds]);

  const refreshRuntimeStatus = useCallback(async () => {
    try {
      const status = await liveAppAPI.runtimeStatus();
      setRuntimeStatus(status);
    } catch (error) {
      log.error('Failed to load live app runtime status', error);
      setRuntimeStatus({
        available: false,
      });
    }
  }, [setRuntimeStatus]);

  useEffect(() => {
    void refreshApps();
    void refreshRunningWorkers();
    void refreshRuntimeStatus();

    const unlistenCreated = api.listen<{ id?: string; sessionId?: string }>('liveapp-created', (payload) => {
      if (payload?.id && payload?.sessionId) {
        bindSessionApp(payload.sessionId, payload.id);
      }
      void refreshApps();
      requestWorkRefresh('live-app-created');
    });
    const unlistenUpdated = api.listen('liveapp-updated', () => {
      void refreshApps();
      requestWorkRefresh('live-app-updated');
    });
    const unlistenRecompiled = api.listen('liveapp-recompiled', () => {
      void refreshApps();
    });
    const unlistenDeleted = api.listen<{ id?: string }>('liveapp-deleted', (payload) => {
      if (payload?.id) {
        markWorkerStopped(payload.id);
      }
      void refreshApps();
    });
    const unlistenRestarted = api.listen<{ id?: string }>('liveapp-worker-restarted', (payload) => {
      if (payload?.id) {
        markWorkerRunning(payload.id);
      }
      void refreshApps();
      void refreshRunningWorkers();
    });
    const unlistenStopped = api.listen<{ id?: string }>('liveapp-worker-stopped', (payload) => {
      if (payload?.id) {
        markWorkerStopped(payload.id);
      }
      void refreshRunningWorkers();
    });
    const runningPoll = appRuntime.schedulePeriodicTask(
      'live-app:running-workers-poll',
      refreshRunningWorkers,
      runtimePolicy.liveAppRunningPoll
    );

    return () => {
      runningPoll.cancel();
      unlistenCreated();
      unlistenUpdated();
      unlistenRecompiled();
      unlistenDeleted();
      unlistenRestarted();
      unlistenStopped();
    };
  }, [bindSessionApp, markWorkerRunning, markWorkerStopped, refreshApps, refreshRunningWorkers, refreshRuntimeStatus]);

  return {
    refreshApps,
    refreshRunningWorkers,
    refreshRuntimeStatus,
  };
}
