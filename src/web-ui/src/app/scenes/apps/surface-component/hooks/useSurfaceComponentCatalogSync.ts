/**
 * useSurfaceComponentCatalogSync — keeps Product App catalog and runtime state in sync.
 */
import { useCallback, useEffect } from 'react';
import { api } from '@/infrastructure/api/service-api/ApiClient';
import { surfaceComponentAPI } from '@/infrastructure/api/service-api/SurfaceComponentAPI';
import { appRuntime, runtimePolicy } from '@/infrastructure/app-runtime';
import { requestWorkRefresh } from '@/app/agentic-os/work/data/workStore';
import { createLogger } from '@/shared/utils/logger';
import { useSurfaceComponentStore } from '../surfaceComponentStore';

const log = createLogger('useSurfaceComponentCatalogSync');

export function useSurfaceComponentCatalogSync() {
  const setApps = useSurfaceComponentStore((state) => state.setApps);
  const setLoading = useSurfaceComponentStore((state) => state.setLoading);
  const setRuntimeStatus = useSurfaceComponentStore((state) => state.setRuntimeStatus);
  const setRunningWorkerIds = useSurfaceComponentStore((state) => state.setRunningWorkerIds);
  const markWorkerRunning = useSurfaceComponentStore((state) => state.markWorkerRunning);
  const markWorkerStopped = useSurfaceComponentStore((state) => state.markWorkerStopped);
  const bindSessionApp = useSurfaceComponentStore((state) => state.bindSessionApp);

  const refreshApps = useCallback(async () => {
    setLoading(true);
    try {
      const apps = await surfaceComponentAPI.listSurfaceComponents();
      setApps(apps);
    } catch (error) {
      log.error('Failed to load Product Apps', error);
    } finally {
      setLoading(false);
    }
  }, [setApps, setLoading]);

  const refreshRunningWorkers = useCallback(async () => {
    try {
      const running = await surfaceComponentAPI.workerListRunning();
      setRunningWorkerIds(running);
    } catch (error) {
      log.error('Failed to load running Product App workers', error);
    }
  }, [setRunningWorkerIds]);

  const refreshRuntimeStatus = useCallback(async () => {
    try {
      const status = await surfaceComponentAPI.runtimeStatus();
      setRuntimeStatus(status);
    } catch (error) {
      log.error('Failed to load Product App runtime status', error);
      setRuntimeStatus({
        available: false,
      });
    }
  }, [setRuntimeStatus]);

  useEffect(() => {
    void refreshApps();
    void refreshRunningWorkers();
    void refreshRuntimeStatus();

    const unlistenCreated = api.listen<{ id?: string; sessionId?: string }>('surface-component-created', (payload) => {
      if (payload?.id && payload?.sessionId) {
        bindSessionApp(payload.sessionId, payload.id);
      }
      void refreshApps();
      requestWorkRefresh('surface-component-created');
    });
    const unlistenUpdated = api.listen('surface-component-updated', () => {
      void refreshApps();
      requestWorkRefresh('surface-component-updated');
    });
    const unlistenRecompiled = api.listen('surface-component-recompiled', () => {
      void refreshApps();
    });
    const unlistenDeleted = api.listen<{ id?: string }>('surface-component-deleted', (payload) => {
      if (payload?.id) {
        markWorkerStopped(payload.id);
      }
      void refreshApps();
    });
    const unlistenRestarted = api.listen<{ id?: string }>('surface-component-worker-restarted', (payload) => {
      if (payload?.id) {
        markWorkerRunning(payload.id);
      }
      void refreshApps();
      void refreshRunningWorkers();
    });
    const unlistenStopped = api.listen<{ id?: string }>('surface-component-worker-stopped', (payload) => {
      if (payload?.id) {
        markWorkerStopped(payload.id);
      }
      void refreshRunningWorkers();
    });
    const runningPoll = appRuntime.schedulePeriodicTask(
      'app-surface:running-workers-poll',
      refreshRunningWorkers,
      runtimePolicy.surfaceComponentRunningPoll
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
