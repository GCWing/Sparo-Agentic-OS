import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProcessingAffordanceProjection } from '../../projections/processingAffordanceProjection';

const AMBIENT_WAIT_DELAY_MS = 3000;

export interface StableProcessingAffordance {
  visible: boolean;
  reserveSpace: boolean;
  resetKey?: string;
}

export function useStableProcessingAffordance(
  projection: ProcessingAffordanceProjection,
  delayMs = AMBIENT_WAIT_DELAY_MS,
): StableProcessingAffordance {
  const [visible, setVisible] = useState(false);
  const ambientSinceRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTurnRef = useRef<string | undefined>(projection.activeTurnId);
  const visibleActivityRef = useRef<string | undefined>(projection.latestVisibleActivityKey);

  useEffect(() => {
    const resetAmbientClock =
      activeTurnRef.current !== projection.activeTurnId ||
      visibleActivityRef.current !== projection.latestVisibleActivityKey ||
      projection.kind !== 'ambient_wait';

    activeTurnRef.current = projection.activeTurnId;
    visibleActivityRef.current = projection.latestVisibleActivityKey;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (projection.kind !== 'ambient_wait') {
      ambientSinceRef.current = null;
      setVisible(false);
      return;
    }

    if (resetAmbientClock || ambientSinceRef.current === null) {
      ambientSinceRef.current = Date.now();
      setVisible(false);
    }

    const elapsedMs = Date.now() - ambientSinceRef.current;
    const remainingMs = Math.max(0, delayMs - elapsedMs);

    if (remainingMs === 0) {
      setVisible(true);
      return;
    }

    timerRef.current = setTimeout(() => {
      setVisible(true);
      timerRef.current = null;
    }, remainingMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [
    delayMs,
    projection.activeTurnId,
    projection.kind,
    projection.latestVisibleActivityKey,
  ]);

  return useMemo(
    () => ({
      visible,
      reserveSpace: projection.reserveSpace,
      resetKey: projection.activeTurnId,
    }),
    [projection.activeTurnId, projection.reserveSpace, visible],
  );
}
