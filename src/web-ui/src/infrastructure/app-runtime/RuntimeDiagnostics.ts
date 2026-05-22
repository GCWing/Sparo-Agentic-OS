export type RuntimeTaskPriority = 'user-visible' | 'background' | 'idle';

export type RuntimeTaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped';

export interface RuntimeTaskRecord {
  id: number;
  name: string;
  priority: RuntimeTaskPriority;
  status: RuntimeTaskStatus;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  reason?: string;
  error?: string;
}

export interface RuntimeApiCallRecord {
  command: string;
  durationMs: number;
  status: 'completed' | 'failed';
  timestamp: number;
}

export interface RuntimeLagRecord {
  observedAt: number;
  lagMs: number;
}

export interface RuntimeContextSnapshot {
  activeSceneId?: string;
  workspacePath?: string;
  activeSessionId?: string;
}

export interface RuntimeSnapshot {
  gateOpen: boolean;
  pressure: boolean;
  safeMode: boolean;
  visibility: DocumentVisibilityState;
  recentTasks: RuntimeTaskRecord[];
  recentApiCalls: RuntimeApiCallRecord[];
  eventLoopLag: RuntimeLagRecord[];
  lastHeartbeatAt?: number;
  capturedAt: number;
  context?: RuntimeContextSnapshot;
}

export interface RuntimeSnapshotState {
  gateOpen: boolean;
  pressure: boolean;
  safeMode: boolean;
  visibility: DocumentVisibilityState;
}

const MAX_TASKS = 100;
const MAX_API_CALLS = 100;
const MAX_LAG_RECORDS = 60;

function pushBounded<T>(items: T[], item: T, max: number): void {
  items.push(item);
  if (items.length > max) {
    items.splice(0, items.length - max);
  }
}

export class RuntimeDiagnostics {
  private readonly recentTasks: RuntimeTaskRecord[] = [];
  private readonly recentApiCalls: RuntimeApiCallRecord[] = [];
  private readonly eventLoopLag: RuntimeLagRecord[] = [];
  private contextGetter: (() => RuntimeContextSnapshot) | null = null;
  private lastHeartbeatAt: number | undefined;

  recordTask(record: RuntimeTaskRecord): void {
    pushBounded(this.recentTasks, record, MAX_TASKS);
  }

  recordApiCall(record: RuntimeApiCallRecord): void {
    pushBounded(this.recentApiCalls, record, MAX_API_CALLS);
  }

  recordEventLoopLag(record: RuntimeLagRecord): void {
    pushBounded(this.eventLoopLag, record, MAX_LAG_RECORDS);
  }

  recordHeartbeat(timestamp = Date.now()): void {
    this.lastHeartbeatAt = timestamp;
  }

  registerContext(getter: () => RuntimeContextSnapshot): () => void {
    this.contextGetter = getter;
    return () => {
      if (this.contextGetter === getter) {
        this.contextGetter = null;
      }
    };
  }

  snapshot(state: RuntimeSnapshotState): RuntimeSnapshot {
    return {
      ...state,
      recentTasks: this.recentTasks.map((record) => ({ ...record })),
      recentApiCalls: this.recentApiCalls.map((record) => ({ ...record })),
      eventLoopLag: this.eventLoopLag.map((record) => ({ ...record })),
      lastHeartbeatAt: this.lastHeartbeatAt,
      capturedAt: Date.now(),
      context: this.contextGetter?.(),
    };
  }
}
