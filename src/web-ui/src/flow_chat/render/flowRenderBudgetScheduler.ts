import { useEffect, useState } from 'react';
import { incrementFlowChatCounter, recordFlowChatMeasure } from '../performance/flowChatPerf';

export type FlowRenderBudgetPriority = 'immediate' | 'next-frame';

export function useRenderBudgetReady(
  enabled: boolean,
  key: string,
  priority: FlowRenderBudgetPriority = 'next-frame'
): boolean {
  const [readyKey, setReadyKey] = useState<string | null>(() =>
    enabled && priority === 'immediate' ? key : null
  );

  useEffect(() => {
    if (!enabled) {
      setReadyKey(null);
      return undefined;
    }

    if (priority === 'immediate') {
      setReadyKey(key);
      return undefined;
    }

    let cancelled = false;
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    incrementFlowChatCounter('renderBudget.queued');

    const frameId = requestAnimationFrame(() => {
      if (cancelled) return;
      setReadyKey(key);
      const finishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      recordFlowChatMeasure('renderBudget.nextFrameWait', finishedAt - startedAt);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
    };
  }, [enabled, key, priority]);

  return enabled && readyKey === key;
}
