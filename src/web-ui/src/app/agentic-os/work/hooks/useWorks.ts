import { useEffect } from 'react';
import { useWorkStore } from '../data/workStore';
import { selectWorkProjections } from '../data/workSelectors';

export function useWorks() {
  const works = useWorkStore((state) => state.works);
  const loaded = useWorkStore((state) => state.loaded);
  const loading = useWorkStore((state) => state.loading);
  const error = useWorkStore((state) => state.error);
  const refreshWorks = useWorkStore((state) => state.refreshWorks);

  useEffect(() => {
    if (!loaded && !loading) {
      void refreshWorks();
    }
  }, [loaded, loading, refreshWorks]);

  return {
    works,
    projections: selectWorkProjections(works),
    loaded,
    loading,
    error,
    refreshWorks,
  };
}
