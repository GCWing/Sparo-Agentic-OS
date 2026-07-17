import type { ConfigScope, ConfigStoredValue } from '../catalog/types';

export interface GetConfigSnapshotRequest {
  scope: ConfigScope;
}

export interface ConfigSnapshot {
  revision: number;
  catalogVersion: string;
  scope: ConfigScope;
  values: Readonly<Record<string, ConfigStoredValue>>;
}

export interface ConfigSnapshotState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  snapshot: ConfigSnapshot | null;
  isRefreshing: boolean;
  error: Error | null;
}

/**
 * A revision transition accepted by the authoritative snapshot store.
 *
 * Consumers must observe configuration changes through this contract instead
 * of listening to raw commit events. The first accepted snapshot has no
 * previous value and establishes the observation baseline.
 */
export interface ConfigSnapshotUpdate {
  previous: ConfigSnapshot | null;
  snapshot: ConfigSnapshot;
  changedSettingIds: readonly string[];
}
