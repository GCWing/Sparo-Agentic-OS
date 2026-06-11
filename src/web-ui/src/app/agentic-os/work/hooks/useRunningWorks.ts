import { useMemo } from 'react';
import { useWorks } from './useWorks';

export function useRunningWorks() {
  const { projections } = useWorks();
  return useMemo(
    () => projections.filter((work) => work.status === 'running'),
    [projections]
  );
}
