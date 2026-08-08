import { useEffect } from 'react';
import { useWorkStore } from '../data/workStore';

export function useWorkObjects() {
  const objects = useWorkStore((state) => state.workObjects);
  const loaded = useWorkStore((state) => state.workObjectsLoaded);
  const refresh = useWorkStore((state) => state.refreshWorkObjects);

  useEffect(() => {
    if (!loaded) {
      void refresh();
    }
  }, [loaded, refresh]);

  return { objects, loaded, refresh };
}
