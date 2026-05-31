export interface FlowChatPerfMeasure {
  count: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
}

export interface FlowChatPerfSnapshot {
  counters: Record<string, number>;
  measures: Record<string, FlowChatPerfMeasure>;
}

declare global {
  interface Window {
    __flowChatPerf?: FlowChatPerfSnapshot;
  }
}

const createSnapshot = (): FlowChatPerfSnapshot => ({
  counters: {},
  measures: {},
});

function getSnapshot(): FlowChatPerfSnapshot | null {
  if (typeof window === 'undefined') {
    return null;
  }

  if (!window.__flowChatPerf) {
    window.__flowChatPerf = createSnapshot();
  }

  return window.__flowChatPerf;
}

export function incrementFlowChatCounter(name: string, amount = 1): void {
  const snapshot = getSnapshot();
  if (!snapshot) return;
  snapshot.counters[name] = (snapshot.counters[name] ?? 0) + amount;
}

export function recordFlowChatMeasure(name: string, durationMs: number): void {
  const snapshot = getSnapshot();
  if (!snapshot) return;

  const current = snapshot.measures[name] ?? {
    count: 0,
    totalMs: 0,
    maxMs: 0,
    lastMs: 0,
  };

  current.count += 1;
  current.totalMs += durationMs;
  current.maxMs = Math.max(current.maxMs, durationMs);
  current.lastMs = durationMs;
  snapshot.measures[name] = current;
}

export function measureFlowChat<T>(name: string, work: () => T): T {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    return work();
  } finally {
    const finishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    recordFlowChatMeasure(name, finishedAt - startedAt);
  }
}
