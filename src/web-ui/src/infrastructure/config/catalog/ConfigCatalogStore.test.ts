import { describe, expect, it, vi } from 'vitest';
import type { ConfigSnapshot, ConfigSnapshotUpdate } from '../snapshot/types';
import {
  ConfigCatalogStore,
  type ConfigCatalogSnapshotSource,
  type ConfigCatalogTransport,
} from './ConfigCatalogStore';
import type { ConfigCatalog } from './types';

function catalog(version: string): ConfigCatalog {
  return { version, settings: [] };
}

function snapshot(revision: number, catalogVersion: string): ConfigSnapshot {
  return {
    revision,
    catalogVersion,
    scope: { kind: 'user' },
    values: {},
  };
}

function createSnapshotSource(initialVersion = 'catalog-v1') {
  let current: ConfigSnapshot | null = null;
  let started = false;
  const listeners = new Set<(update: ConfigSnapshotUpdate) => void>();
  const unlisten = vi.fn();

  const accept = (next: ConfigSnapshot) => {
    const previous = current;
    current = next;
    const update = { previous, snapshot: next, changedSettingIds: [] };
    listeners.forEach((listener) => listener(update));
  };

  const source: ConfigCatalogSnapshotSource = {
    getState: () => ({
      status: current ? 'ready' : 'idle',
      snapshot: current,
      isRefreshing: false,
      error: null,
    }),
    start: async () => {
      if (!started) {
        started = true;
        accept(snapshot(1, initialVersion));
      }
      return current!;
    },
    subscribeAccepted: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        unlisten();
      };
    },
  };

  return {
    source,
    accept: (revision: number, catalogVersion: string) => accept(snapshot(revision, catalogVersion)),
    unlisten,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe('ConfigCatalogStore', () => {
  it('reloads only after an accepted snapshot reports a new catalog version', async () => {
    const snapshots = createSnapshotSource();
    const transport: ConfigCatalogTransport = {
      describeConfigCatalog: vi.fn()
        .mockResolvedValueOnce(catalog('catalog-v1'))
        .mockResolvedValueOnce(catalog('catalog-v2')),
    };
    const store = new ConfigCatalogStore(transport, () => snapshots.source);
    await store.load();

    snapshots.accept(2, 'catalog-v2');

    await vi.waitFor(() => expect(store.getState().catalog?.version).toBe('catalog-v2'));
    expect(transport.describeConfigCatalog).toHaveBeenCalledTimes(2);
  });

  it('ignores an older catalog response after a newer accepted snapshot', async () => {
    const stale = deferred<ConfigCatalog>();
    const target = deferred<ConfigCatalog>();
    const snapshots = createSnapshotSource();
    const transport: ConfigCatalogTransport = {
      describeConfigCatalog: vi.fn()
        .mockReturnValueOnce(stale.promise)
        .mockReturnValueOnce(target.promise),
    };
    const store = new ConfigCatalogStore(transport, () => snapshots.source);

    const staleLoad = store.load();
    await vi.waitFor(() => expect(transport.describeConfigCatalog).toHaveBeenCalledTimes(1));
    snapshots.accept(2, 'catalog-v2');
    await vi.waitFor(() => expect(transport.describeConfigCatalog).toHaveBeenCalledTimes(2));

    target.resolve(catalog('catalog-v2'));
    await vi.waitFor(() => expect(store.getState().catalog?.version).toBe('catalog-v2'));

    stale.resolve(catalog('catalog-v1'));
    await expect(staleLoad).resolves.toEqual(catalog('catalog-v1'));
    expect(store.getState().catalog?.version).toBe('catalog-v2');
  });

  it('does not let a forced refresh duplicate an in-flight accepted version requirement', async () => {
    const target = deferred<ConfigCatalog>();
    const snapshots = createSnapshotSource();
    const transport: ConfigCatalogTransport = {
      describeConfigCatalog: vi.fn()
        .mockResolvedValueOnce(catalog('catalog-v1'))
        .mockReturnValueOnce(target.promise),
    };
    const store = new ConfigCatalogStore(transport, () => snapshots.source);
    await store.load();

    snapshots.accept(2, 'catalog-v2');
    await vi.waitFor(() => expect(transport.describeConfigCatalog).toHaveBeenCalledTimes(2));
    const forcedLoad = store.load(true);
    expect(transport.describeConfigCatalog).toHaveBeenCalledTimes(2);

    target.resolve(catalog('catalog-v2'));
    await expect(forcedLoad).resolves.toEqual(catalog('catalog-v2'));
    expect(store.getState().catalog?.version).toBe('catalog-v2');
  });

  it('does not accept a catalog that misses the requested version', async () => {
    const snapshots = createSnapshotSource();
    const transport: ConfigCatalogTransport = {
      describeConfigCatalog: vi.fn().mockResolvedValue(catalog('catalog-v1')),
    };
    const store = new ConfigCatalogStore(transport, () => snapshots.source);

    await expect(store.ensureVersion('catalog-v2')).rejects.toThrow(
      'expected catalog-v2, received catalog-v1',
    );
    expect(store.getState()).toMatchObject({ status: 'error', catalog: null });
  });

  it('deduplicates concurrent requests for the same target version', async () => {
    const target = deferred<ConfigCatalog>();
    const snapshots = createSnapshotSource();
    const transport: ConfigCatalogTransport = {
      describeConfigCatalog: vi.fn().mockReturnValue(target.promise),
    };
    const store = new ConfigCatalogStore(transport, () => snapshots.source);

    const first = store.ensureVersion('catalog-v2');
    const second = store.ensureVersion('catalog-v2');
    expect(transport.describeConfigCatalog).toHaveBeenCalledTimes(1);

    target.resolve(catalog('catalog-v2'));
    await expect(Promise.all([first, second])).resolves.toEqual([
      catalog('catalog-v2'),
      catalog('catalog-v2'),
    ]);
  });

  it('releases the accepted-snapshot subscription on stop', async () => {
    const snapshots = createSnapshotSource();
    const transport: ConfigCatalogTransport = {
      describeConfigCatalog: vi.fn().mockResolvedValue(catalog('catalog-v1')),
    };
    const store = new ConfigCatalogStore(transport, () => snapshots.source);

    await store.load();
    store.stop();

    expect(snapshots.unlisten).toHaveBeenCalledOnce();
  });
});
