/**
 * Keeps Product App Runtime catalog and host lifecycle state in sync.
 */
import { useCallback, useEffect } from 'react';
import { api } from '@/infrastructure/api/service-api/ApiClient';
import { appRuntime, runtimePolicy } from '@/infrastructure/app-runtime';
import { requestWorkRefresh } from '@/app/agentic-os/work/data/workStore';
import { createLogger } from '@/shared/utils/logger';
import { productAppRuntimeHostEvents } from '@/shared/types/product-app-runtime';
import { useProductAppRuntimeStore } from './productAppRuntimeStore';
import { productAppRuntimeHostAPI } from '@/infrastructure/api/service-api/ProductAppRuntimeHostAPI';

const log = createLogger('ProductAppRuntimeCatalogSync');

export function useProductAppRuntimeCatalogSync() {
  const setApps = useProductAppRuntimeStore((state) => state.setApps);
  const setLoading = useProductAppRuntimeStore((state) => state.setLoading);
  const setRuntimeStatus = useProductAppRuntimeStore((state) => state.setRuntimeStatus);
  const setRunningWorkerIds = useProductAppRuntimeStore((state) => state.setRunningWorkerIds);
  const markWorkerRunning = useProductAppRuntimeStore((state) => state.markWorkerRunning);
  const markWorkerStopped = useProductAppRuntimeStore((state) => state.markWorkerStopped);
  const bindSessionApp = useProductAppRuntimeStore((state) => state.bindSessionApp);

  const refreshApps = useCallback(async () => {
    setLoading(true);
    try {
      const apps = await productAppRuntimeHostAPI.listHostSurfaces();
      setApps(apps);
    } catch (error) {
      log.error('Failed to load Product Apps', error);
    } finally {
      setLoading(false);
    }
  }, [setApps, setLoading]);

  const refreshRunningWorkers = useCallback(async () => {
    try {
      const running = await productAppRuntimeHostAPI.listRunningWorkers();
      setRunningWorkerIds(running);
    } catch (error) {
      log.error('Failed to load running Product App workers', error);
    }
  }, [setRunningWorkerIds]);

  const refreshRuntimeStatus = useCallback(async () => {
    try {
      const status = await productAppRuntimeHostAPI.hostRuntimeStatus();
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

    const unlistenCreated = api.listen<{ id?: string; sessionId?: string }>(productAppRuntimeHostEvents.created, (payload) => {
      if (payload?.id && payload?.sessionId) {
        bindSessionApp(payload.sessionId, payload.id);
      }
      void refreshApps();
      requestWorkRefresh('product-app-runtime-host-created');
    });
    const unlistenUpdated = api.listen<{ id?: string }>(productAppRuntimeHostEvents.updated, (payload) => {
      productAppRuntimeHostAPI.invalidateHostSurface(payload?.id);
      void refreshApps();
      requestWorkRefresh('product-app-runtime-host-updated');
    });
    const unlistenRecompiled = api.listen<{ id?: string }>(productAppRuntimeHostEvents.recompiled, (payload) => {
      productAppRuntimeHostAPI.invalidateHostSurface(payload?.id);
      void refreshApps();
    });
    const unlistenRolledBack = api.listen<{ id?: string }>(productAppRuntimeHostEvents.rolledBack, (payload) => {
      productAppRuntimeHostAPI.invalidateHostSurface(payload?.id);
      void refreshApps();
    });
    const unlistenDeleted = api.listen<{ id?: string }>(productAppRuntimeHostEvents.deleted, (payload) => {
      productAppRuntimeHostAPI.invalidateHostSurface(payload?.id);
      if (payload?.id) {
        markWorkerStopped(payload.id);
      }
      void refreshApps();
    });
    const unlistenRestarted = api.listen<{ id?: string }>(productAppRuntimeHostEvents.workerRestarted, (payload) => {
      productAppRuntimeHostAPI.invalidateHostSurface(payload?.id);
      if (payload?.id) {
        markWorkerRunning(payload.id);
      }
      void refreshApps();
      void refreshRunningWorkers();
    });
    const unlistenStopped = api.listen<{ id?: string }>(productAppRuntimeHostEvents.workerStopped, (payload) => {
      if (payload?.id) {
        markWorkerStopped(payload.id);
      }
      void refreshRunningWorkers();
    });
    const runningPoll = appRuntime.schedulePeriodicTask(
      'product-app-runtime:running-workers-poll',
      refreshRunningWorkers,
      runtimePolicy.productAppRuntimeRunningPoll
    );

    return () => {
      runningPoll.cancel();
      unlistenCreated();
      unlistenUpdated();
      unlistenRecompiled();
      unlistenRolledBack();
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
