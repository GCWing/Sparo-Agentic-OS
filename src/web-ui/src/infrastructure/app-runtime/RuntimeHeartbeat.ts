import { isTauriRuntime } from '@/infrastructure/runtime';
import { createLogger } from '@/shared/utils/logger';
import type { RuntimeSnapshot } from './RuntimeDiagnostics';

const log = createLogger('RuntimeHeartbeat');

const HEARTBEAT_INTERVAL_MS = 1500;

export interface RuntimeHeartbeatSender {
  send: (snapshot: RuntimeSnapshot) => Promise<void>;
}

export class RuntimeHeartbeat {
  private timer: number | null = null;
  private sender: RuntimeHeartbeatSender | null = null;
  private inFlight = false;

  constructor(
    private readonly snapshot: () => RuntimeSnapshot,
    private readonly onSent: () => void
  ) {}

  configure(sender: RuntimeHeartbeatSender): void {
    this.sender = sender;
  }

  start(): void {
    if (this.timer !== null || !this.sender || !isTauriRuntime()) {
      return;
    }

    const tick = () => {
      void this.sendHeartbeat();
      this.timer = window.setTimeout(tick, HEARTBEAT_INTERVAL_MS);
    };

    tick();
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.sender || this.inFlight) {
      return;
    }

    const snapshot = this.snapshot();
    this.inFlight = true;
    try {
      await this.sender.send(snapshot);
      this.onSent();
    } catch (error) {
      log.debug('Runtime heartbeat send failed', { error });
    } finally {
      this.inFlight = false;
    }
  }
}
