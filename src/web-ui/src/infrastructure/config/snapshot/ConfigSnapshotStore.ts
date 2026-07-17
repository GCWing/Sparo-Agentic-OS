import { configAPI } from '@/infrastructure/api';
import { createLogger } from '@/shared/utils/logger';
import type { ConfigScope, ConfigStoredValue } from '../catalog/types';
import type { ConfigCommittedEvent } from '../transaction/types';
import type {
  ConfigSnapshot,
  ConfigSnapshotState,
  ConfigSnapshotUpdate,
  GetConfigSnapshotRequest,
} from './types';

const log = createLogger('ConfigSnapshotStore');

export interface ConfigSnapshotTransport {
  getConfigSnapshot(request: GetConfigSnapshotRequest): Promise<ConfigSnapshot>;
  onConfigCommitted(callback: (event: ConfigCommittedEvent) => void): () => void;
  onConfigSnapshotRefreshed(callback: (snapshot: ConfigSnapshot) => void): () => void;
}

const INITIAL_STATE: ConfigSnapshotState = {
  status: 'idle',
  snapshot: null,
  isRefreshing: false,
  error: null,
};

function scopesEqual(left: ConfigScope, right: ConfigScope): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === 'workspace' && right.kind === 'workspace') {
    return left.workspaceId === right.workspaceId;
  }
  if (left.kind === 'session' && right.kind === 'session') {
    return left.sessionId === right.sessionId;
  }
  return left.kind === 'user' && right.kind === 'user';
}

function storedValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => storedValuesEqual(value, right[index]));
  }
  if (
    left === null
    || right === null
    || typeof left !== 'object'
    || typeof right !== 'object'
  ) {
    return false;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => (
      Object.prototype.hasOwnProperty.call(rightRecord, key)
      && storedValuesEqual(leftRecord[key], rightRecord[key])
    ));
}

export class ConfigSnapshotStore {
  private state: ConfigSnapshotState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private readonly acceptedListeners = new Set<(update: ConfigSnapshotUpdate) => void>();
  private readonly pendingEvents = new Map<number, ConfigCommittedEvent>();
  private readonly lastChangedRevision = new Map<string, number>();
  private refreshPromise: Promise<ConfigSnapshot> | null = null;
  private refreshRequestedDuringRefresh = false;
  private unlisten: (() => void) | null = null;

  constructor(
    private readonly transport: ConfigSnapshotTransport,
    private readonly scope: ConfigScope = { kind: 'user' },
  ) {}

  getState = (): ConfigSnapshotState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  subscribeAccepted = (
    listener: (update: ConfigSnapshotUpdate) => void,
  ): (() => void) => {
    this.acceptedListeners.add(listener);
    return () => this.acceptedListeners.delete(listener);
  };

  getValue(settingId: string): ConfigStoredValue | undefined {
    return this.state.snapshot?.values[settingId];
  }

  didSettingChangeAfter(settingId: string, revision: number): boolean {
    return (this.lastChangedRevision.get(settingId) ?? -1) > revision;
  }

  start(): Promise<ConfigSnapshot> {
    if (this.unlisten) {
      if (this.state.snapshot) {
        return Promise.resolve(this.state.snapshot);
      }
      return this.refresh();
    }

    const unlistenCommitted = this.transport.onConfigCommitted((event) => {
      this.handleCommittedEvent(event);
    });
    const unlistenSnapshotRefreshed = this.transport.onConfigSnapshotRefreshed((snapshot) => {
      this.handleAuthoritativeSnapshot(snapshot);
    });
    this.unlisten = () => {
      unlistenCommitted();
      unlistenSnapshotRefreshed();
    };
    return this.refresh();
  }

  stop(): void {
    this.unlisten?.();
    this.unlisten = null;
    this.pendingEvents.clear();
    this.lastChangedRevision.clear();
    this.refreshRequestedDuringRefresh = false;
  }

  refresh(): Promise<ConfigSnapshot> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.updateState({
      ...this.state,
      status: this.state.snapshot ? this.state.status : 'loading',
      isRefreshing: true,
      error: null,
    });

    this.refreshPromise = this.transport
      .getConfigSnapshot({ scope: this.scope })
      .then((snapshot) => {
        if (!scopesEqual(snapshot.scope, this.scope)) {
          throw new Error(`Config snapshot scope mismatch: expected ${this.scope.kind}, received ${snapshot.scope.kind}`);
        }

        const currentSnapshot = this.state.snapshot;
        if (!currentSnapshot || snapshot.revision > currentSnapshot.revision) {
          this.acceptSnapshot(snapshot);
        } else {
          this.updateState({
            ...this.state,
            status: 'ready',
            isRefreshing: false,
            error: null,
          });
        }

        this.discardAppliedEvents();
        this.applyContiguousPendingEvents();

        const resolvedSnapshot = this.state.snapshot;
        if (!resolvedSnapshot) {
          throw new Error('Config snapshot refresh completed without a snapshot');
        }

        const nextPendingRevision = Math.min(...this.pendingEvents.keys());
        if (Number.isFinite(nextPendingRevision) && nextPendingRevision > resolvedSnapshot.revision + 1) {
          log.warn('Config event gap remains after snapshot refresh', {
            revision: resolvedSnapshot.revision,
            nextPendingRevision,
          });
        }

        return resolvedSnapshot;
      })
      .catch((error: unknown) => {
        const resolvedError = error instanceof Error ? error : new Error(String(error));
        this.updateState({
          ...this.state,
          status: 'error',
          isRefreshing: false,
          error: resolvedError,
        });
        log.error('Failed to refresh config snapshot', { error: resolvedError });
        throw resolvedError;
      })
      .finally(() => {
        const shouldRefreshAgain = this.refreshRequestedDuringRefresh && this.hasPendingGap();
        this.refreshRequestedDuringRefresh = false;
        this.refreshPromise = null;
        if (shouldRefreshAgain) {
          void this.refresh().catch(() => undefined);
        }
      });

    return this.refreshPromise;
  }

  private handleCommittedEvent(event: ConfigCommittedEvent): void {
    if (!scopesEqual(event.scope, this.scope)) {
      return;
    }

    const snapshot = this.state.snapshot;
    if (snapshot && event.revision <= snapshot.revision) {
      return;
    }

    if (!snapshot || this.refreshPromise) {
      this.pendingEvents.set(event.revision, event);
      this.refreshRequestedDuringRefresh ||= Boolean(this.refreshPromise);
      if (!this.refreshPromise) {
        void this.refresh().catch(() => undefined);
      }
      return;
    }

    if (event.revision === snapshot.revision + 1) {
      this.applyEvent(event);
      this.applyContiguousPendingEvents();
      return;
    }

    this.pendingEvents.set(event.revision, event);
    void this.refresh().catch(() => undefined);
  }

  private handleAuthoritativeSnapshot(snapshot: ConfigSnapshot): void {
    if (!scopesEqual(snapshot.scope, this.scope)) {
      log.error('Rejected config snapshot refresh with a mismatched scope', {
        expectedScope: this.scope,
        receivedScope: snapshot.scope,
        revision: snapshot.revision,
      });
      return;
    }

    const current = this.state.snapshot;
    if (current && snapshot.revision <= current.revision) {
      return;
    }

    this.acceptSnapshot(snapshot);
    this.discardAppliedEvents();
    this.applyContiguousPendingEvents();
  }

  private applyEvent(event: ConfigCommittedEvent): void {
    const snapshot = this.state.snapshot;
    if (!snapshot || event.revision !== snapshot.revision + 1) {
      return;
    }

    const values: Record<string, ConfigStoredValue> = { ...snapshot.values };
    for (const change of event.changes) {
      values[change.settingId] = change.newValue;
    }

    this.acceptSnapshot({
      ...snapshot,
      revision: event.revision,
      catalogVersion: event.catalogVersion,
      values,
    });
  }

  private applyContiguousPendingEvents(): void {
    let snapshot = this.state.snapshot;
    while (snapshot) {
      const nextRevision = snapshot.revision + 1;
      const nextEvent = this.pendingEvents.get(nextRevision);
      if (!nextEvent) {
        return;
      }
      this.pendingEvents.delete(nextRevision);
      this.applyEvent(nextEvent);
      snapshot = this.state.snapshot;
    }
  }

  private discardAppliedEvents(): void {
    const revision = this.state.snapshot?.revision;
    if (revision === undefined) {
      return;
    }
    for (const pendingRevision of this.pendingEvents.keys()) {
      if (pendingRevision <= revision) {
        this.pendingEvents.delete(pendingRevision);
      }
    }
  }

  private hasPendingGap(): boolean {
    const revision = this.state.snapshot?.revision;
    if (revision === undefined || this.pendingEvents.size === 0) {
      return this.pendingEvents.size > 0;
    }
    return Math.min(...this.pendingEvents.keys()) > revision + 1;
  }

  private acceptSnapshot(snapshot: ConfigSnapshot): void {
    const previous = this.state.snapshot;
    if (previous && snapshot.revision <= previous.revision) {
      return;
    }

    const changedSettingIds = previous
      ? this.diffSettingIds(previous, snapshot)
      : [];
    for (const settingId of changedSettingIds) {
      this.lastChangedRevision.set(settingId, snapshot.revision);
    }

    this.updateState({
      status: 'ready',
      snapshot,
      isRefreshing: false,
      error: null,
    });

    const update: ConfigSnapshotUpdate = {
      previous,
      snapshot,
      changedSettingIds,
    };
    for (const listener of this.acceptedListeners) {
      try {
        listener(update);
      } catch (error) {
        log.error('Config snapshot accepted listener failed', {
          revision: snapshot.revision,
          error,
        });
      }
    }
  }

  private diffSettingIds(
    previous: ConfigSnapshot,
    next: ConfigSnapshot,
  ): string[] {
    const settingIds = new Set([
      ...Object.keys(previous.values),
      ...Object.keys(next.values),
    ]);
    const changedSettingIds: string[] = [];
    for (const settingId of settingIds) {
      if (!storedValuesEqual(previous.values[settingId], next.values[settingId])) {
        changedSettingIds.push(settingId);
      }
    }
    return changedSettingIds;
  }

  private updateState(nextState: ConfigSnapshotState): void {
    this.state = nextState;
    this.listeners.forEach((listener) => listener());
  }
}

export const configSnapshotStore = new ConfigSnapshotStore(configAPI);
