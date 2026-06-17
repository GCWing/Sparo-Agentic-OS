import { useEffect } from 'react';
import { useBackgroundProcessStore } from '../data/backgroundProcessStore';

export function useBackgroundProcesses() {
  const processes = useBackgroundProcessStore((state) => state.processes);
  const generatedAt = useBackgroundProcessStore((state) => state.generatedAt);
  const loaded = useBackgroundProcessStore((state) => state.loaded);
  const loading = useBackgroundProcessStore((state) => state.loading);
  const error = useBackgroundProcessStore((state) => state.error);
  const runningKind = useBackgroundProcessStore((state) => state.runningKind);
  const refreshProcesses = useBackgroundProcessStore((state) => state.refreshProcesses);
  const runProcess = useBackgroundProcessStore((state) => state.runProcess);

  useEffect(() => {
    if (!loaded && !loading) {
      void refreshProcesses();
    }
  }, [loaded, loading, refreshProcesses]);

  return {
    processes,
    generatedAt,
    loaded,
    loading,
    error,
    runningKind,
    refreshProcesses,
    runProcess,
  };
}
