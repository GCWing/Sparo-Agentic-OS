import { createLogger } from '@/shared/utils/logger';
import {
  RuntimeDiagnostics,
  type RuntimeTaskPriority,
  type RuntimeTaskRecord,
} from './RuntimeDiagnostics';
import { RuntimeHeartbeat } from './RuntimeHeartbeat';

const log = createLogger('AppRuntime');

export type { RuntimeTaskPriority };

export interface RuntimeTaskOptions {
  priority?: RuntimeTaskPriority;
  delayMs?: number;
  idleTimeoutMs?: number;
  slowMs?: number;
  pauseWhenHidden?: boolean;
  reason?: string;
}

export interface RuntimePeriodicTaskOptions extends RuntimeTaskOptions {
  intervalMs: number;
  initialDelayMs?: number;
  runImmediately?: boolean;
}

export interface RuntimeTaskHandle {
  cancel: () => void;
}

type TaskRun = () => Promise<void> | void;

interface QueuedTask {
  id: number;
  name: string;
  priority: RuntimeTaskPriority;
  run: TaskRun;
  slowMs: number;
  cancelled: boolean;
  record: RuntimeTaskRecord;
}

const PRIORITY_ORDER: Record<RuntimeTaskPriority, number> = {
  'user-visible': 0,
  background: 1,
  idle: 2,
};

const DEFAULT_SLOW_MS = 750;
const DEFAULT_IDLE_TIMEOUT_MS = 3000;
const EVENT_LOOP_SAMPLE_MS = 2000;
const EVENT_LOOP_WARN_MS = 250;
const EVENT_LOOP_PRESSURE_MS = 750;
const PRESSURE_RECOVERY_TICKS = 2;
const RECENT_USER_INPUT_HOLD_MS = 500;

export class AppRuntime {
  readonly diagnostics = new RuntimeDiagnostics();
  readonly heartbeat: RuntimeHeartbeat | undefined;

  private nextTaskId = 1;
  private readonly queue: QueuedTask[] = [];
  private activeCount = 0;
  private concurrency = 2;
  private gateOpen = false;
  private eventLoopPressure = false;
  private runtimeSafeMode = false;
  private recoveredLagTicks = 0;
  private monitorTimer: number | null = null;
  private userInputHoldTimer: number | null = null;
  private lastMonitorTick = 0;
  private lastUserInputAt = 0;
  private monitorsStarted = false;

  constructor() {
    this.heartbeat = new RuntimeHeartbeat(
      () => this.snapshot(),
      () => this.diagnostics.recordHeartbeat()
    );
  }

  activate(): void {
    if (this.gateOpen) {
      return;
    }
    this.gateOpen = true;
    this.pump();
  }

  startMonitors(): void {
    if (this.monitorsStarted) {
      return;
    }
    this.monitorsStarted = true;
    this.startEventLoopMonitor();
    this.installVisibilityAndInputListeners();
  }

  setConcurrency(concurrency: number): void {
    this.concurrency = Math.max(1, Math.floor(concurrency));
    this.pump();
  }

  setSafeMode(enabled: boolean): void {
    if (this.runtimeSafeMode === enabled) {
      return;
    }
    this.runtimeSafeMode = enabled;
    if (enabled) {
      log.warn('Runtime safe mode enabled');
    } else {
      this.pump();
    }
  }

  scheduleTask(
    name: string,
    run: TaskRun,
    options: RuntimeTaskOptions = {}
  ): RuntimeTaskHandle {
    const id = this.nextTaskId++;
    const priority = options.priority ?? 'idle';
    const record: RuntimeTaskRecord = {
      id,
      name,
      priority,
      status: 'queued',
      queuedAt: Date.now(),
      reason: options.reason,
    };
    this.diagnostics.recordTask(record);

    const task: QueuedTask = {
      id,
      name,
      priority,
      run,
      slowMs: options.slowMs ?? DEFAULT_SLOW_MS,
      cancelled: false,
      record,
    };

    let delayTimer: number | null = null;
    let idleHandle: number | null = null;

    const enqueue = () => {
      if (task.cancelled) {
        this.markCancelled(task);
        return;
      }

      this.queue.push(task);
      this.queue.sort((left, right) => PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority]);
      this.pump();
    };

    const requestIdle = () => {
      if (task.cancelled) {
        this.markCancelled(task);
        return;
      }

      if (priority === 'user-visible') {
        enqueue();
        return;
      }

      const timeout = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
      const idleRequester = window.requestIdleCallback;
      if (typeof idleRequester === 'function') {
        idleHandle = idleRequester(enqueue, { timeout });
        return;
      }
      delayTimer = window.setTimeout(enqueue, Math.min(timeout, 50));
    };

    delayTimer = window.setTimeout(requestIdle, options.delayMs ?? 0);

    return {
      cancel: () => {
        task.cancelled = true;
        if (delayTimer !== null) {
          window.clearTimeout(delayTimer);
          delayTimer = null;
        }
        if (idleHandle !== null && typeof window.cancelIdleCallback === 'function') {
          window.cancelIdleCallback(idleHandle);
          idleHandle = null;
        }
        this.markCancelled(task);
      },
    };
  }

  schedulePeriodicTask(
    name: string,
    run: TaskRun,
    options: RuntimePeriodicTaskOptions
  ): RuntimeTaskHandle {
    let cancelled = false;
    let timer: number | null = null;
    let activeHandle: RuntimeTaskHandle | null = null;
    let running = false;

    const clearTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    let scheduleNext: (delayMs: number) => void = () => {};

    const tick = () => {
      if (cancelled) {
        return;
      }

      const priority = options.priority ?? 'background';
      if (options.pauseWhenHidden && document.visibilityState !== 'visible') {
        this.recordSkipped(name, priority, 'document-hidden');
        scheduleNext(options.intervalMs);
        return;
      }

      if (this.eventLoopPressure && priority !== 'user-visible') {
        this.recordSkipped(name, priority, 'event-loop-pressure');
        scheduleNext(options.intervalMs);
        return;
      }

      if (this.runtimeSafeMode && priority !== 'user-visible') {
        this.recordSkipped(name, priority, 'runtime-safe-mode');
        scheduleNext(options.intervalMs);
        return;
      }

      if (running) {
        this.recordSkipped(name, priority, 'previous-run-active');
        scheduleNext(Math.max(1000, Math.floor(options.intervalMs / 2)));
        return;
      }

      running = true;
      activeHandle = this.scheduleTask(
        name,
        async () => {
          try {
            await run();
          } finally {
            running = false;
            activeHandle = null;
            if (!cancelled) {
              scheduleNext(options.intervalMs);
            }
          }
        },
        options
      );
    };

    scheduleNext = (delayMs: number) => {
      clearTimer();
      timer = window.setTimeout(tick, Math.max(0, delayMs));
    };

    if (options.runImmediately) {
      tick();
    } else {
      scheduleNext(options.initialDelayMs ?? options.intervalMs);
    }

    return {
      cancel: () => {
        cancelled = true;
        clearTimer();
        activeHandle?.cancel();
        activeHandle = null;
      },
    };
  }

  snapshot() {
    return this.diagnostics.snapshot({
      gateOpen: this.gateOpen,
      pressure: this.eventLoopPressure,
      safeMode: this.runtimeSafeMode,
      visibility: document.visibilityState,
    });
  }

  private pump(): void {
    while (this.activeCount < this.concurrency) {
      const nextIndex = this.queue.findIndex((task) => this.canDispatch(task.priority));
      if (nextIndex === -1) {
        return;
      }

      const [task] = this.queue.splice(nextIndex, 1);
      if (!task || task.cancelled) {
        if (task) {
          this.markCancelled(task);
        }
        continue;
      }

      this.runTask(task);
    }
  }

  private canDispatch(priority: RuntimeTaskPriority): boolean {
    if (priority === 'user-visible') {
      return true;
    }
    if (!this.gateOpen || this.eventLoopPressure || this.runtimeSafeMode) {
      return false;
    }
    if (priority === 'idle' && Date.now() - this.lastUserInputAt < RECENT_USER_INPUT_HOLD_MS) {
      return false;
    }
    return true;
  }

  private runTask(task: QueuedTask): void {
    this.activeCount += 1;
    task.record.status = 'running';
    task.record.startedAt = Date.now();

    void Promise.resolve()
      .then(() => task.run())
      .then(() => {
        const finishedAt = Date.now();
        const durationMs = finishedAt - (task.record.startedAt ?? finishedAt);
        task.record.status = task.cancelled ? 'cancelled' : 'completed';
        task.record.finishedAt = finishedAt;
        task.record.durationMs = durationMs;
        if (durationMs > task.slowMs) {
          log.warn('Runtime task was slow', {
            name: task.name,
            durationMs,
            priority: task.priority,
          });
        }
      })
      .catch((error) => {
        const finishedAt = Date.now();
        task.record.status = 'failed';
        task.record.finishedAt = finishedAt;
        task.record.durationMs = finishedAt - (task.record.startedAt ?? finishedAt);
        task.record.error = error instanceof Error ? error.message : String(error);
        log.error('Runtime task failed', {
          name: task.name,
          priority: task.priority,
          error,
        });
      })
      .finally(() => {
        this.activeCount -= 1;
        this.pump();
      });
  }

  private markCancelled(task: QueuedTask): void {
    if (task.record.status === 'queued') {
      task.record.status = 'cancelled';
      task.record.finishedAt = Date.now();
    }
  }

  private recordSkipped(name: string, priority: RuntimeTaskPriority, reason: string): void {
    this.diagnostics.recordTask({
      id: this.nextTaskId++,
      name,
      priority,
      status: 'skipped',
      queuedAt: Date.now(),
      finishedAt: Date.now(),
      reason,
    });
  }

  private startEventLoopMonitor(): void {
    if (this.monitorTimer !== null) {
      return;
    }

    this.lastMonitorTick = Date.now();

    const tick = () => {
      const now = Date.now();
      const lagMs = Math.max(0, now - this.lastMonitorTick - EVENT_LOOP_SAMPLE_MS);
      this.lastMonitorTick = now;

      if (lagMs > EVENT_LOOP_WARN_MS) {
        this.diagnostics.recordEventLoopLag({ observedAt: now, lagMs });
        log.warn('Event loop lag observed', { lagMs });
      }

      if (lagMs > EVENT_LOOP_PRESSURE_MS) {
        this.recoveredLagTicks = 0;
        if (!this.eventLoopPressure) {
          this.eventLoopPressure = true;
          log.warn('Runtime entered event-loop pressure', { lagMs });
        }
      } else if (this.eventLoopPressure && lagMs < EVENT_LOOP_WARN_MS) {
        this.recoveredLagTicks += 1;
        if (this.recoveredLagTicks >= PRESSURE_RECOVERY_TICKS) {
          this.eventLoopPressure = false;
          this.recoveredLagTicks = 0;
          this.pump();
        }
      }

      this.monitorTimer = window.setTimeout(tick, EVENT_LOOP_SAMPLE_MS);
    };

    this.monitorTimer = window.setTimeout(tick, EVENT_LOOP_SAMPLE_MS);
  }

  private installVisibilityAndInputListeners(): void {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        this.pump();
      }
    };
    const handleUserInput = () => {
      this.lastUserInputAt = Date.now();
      if (this.userInputHoldTimer !== null) {
        window.clearTimeout(this.userInputHoldTimer);
      }
      this.userInputHoldTimer = window.setTimeout(() => {
        this.userInputHoldTimer = null;
        this.pump();
      }, RECENT_USER_INPUT_HOLD_MS);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);
    window.addEventListener('pointerdown', handleUserInput, { passive: true });
    window.addEventListener('keydown', handleUserInput, { passive: true });
  }
}

export const appRuntime = new AppRuntime();
