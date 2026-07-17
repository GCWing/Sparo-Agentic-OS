import { describe, expect, it, vi } from 'vitest';
import type { ConfigCommittedEvent } from '../transaction/types';
import { ConfigSnapshotStore, type ConfigSnapshotTransport } from './ConfigSnapshotStore';
import type { ConfigSnapshot } from './types';

const USER_SCOPE = { kind: 'user' } as const;

function createSnapshot(revision: number, value: string): ConfigSnapshot {
  return {
    revision,
    catalogVersion: 'catalog-v1',
    scope: USER_SCOPE,
    values: {
      'core.test.value': { kind: 'value', value },
    },
  };
}

function createEvent(revision: number, value: string): ConfigCommittedEvent {
  return {
    commitId: `commit-${revision}`,
    revision,
    catalogVersion: 'catalog-v1',
    scope: USER_SCOPE,
    source: { kind: 'system', surface: 'test' },
    changes: [{
      settingId: 'core.test.value',
      oldValue: { kind: 'value', value: `value-${revision - 1}` },
      newValue: { kind: 'value', value },
      applyStrategy: 'reactive',
    }],
    affectedSections: [{
      categoryId: 'system',
      tabId: 'test',
      sectionId: 'test',
      fieldIds: ['value'],
    }],
    committedAt: '2026-07-13T00:00:00Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createTransport(getConfigSnapshot: ConfigSnapshotTransport['getConfigSnapshot']) {
  let emit!: (event: ConfigCommittedEvent) => void;
  let emitSnapshotRefreshed!: (snapshot: ConfigSnapshot) => void;
  const unlistenCommitted = vi.fn();
  const unlistenSnapshotRefreshed = vi.fn();
  const transport: ConfigSnapshotTransport = {
    getConfigSnapshot,
    onConfigCommitted: (callback) => {
      emit = callback;
      return unlistenCommitted;
    },
    onConfigSnapshotRefreshed: (callback) => {
      emitSnapshotRefreshed = callback;
      return unlistenSnapshotRefreshed;
    },
  };
  return {
    transport,
    emit: (event: ConfigCommittedEvent) => emit(event),
    emitSnapshotRefreshed: (snapshot: ConfigSnapshot) => emitSnapshotRefreshed(snapshot),
    unlistenCommitted,
    unlistenSnapshotRefreshed,
  };
}

describe('ConfigSnapshotStore', () => {
  it('applies only the next contiguous revision without refetching', async () => {
    const getConfigSnapshot = vi.fn(async () => createSnapshot(1, 'value-1'));
    const harness = createTransport(getConfigSnapshot);
    const store = new ConfigSnapshotStore(harness.transport);
    const accepted = vi.fn();
    store.subscribeAccepted(accepted);

    await store.start();
    harness.emit({ ...createEvent(2, 'value-2'), catalogVersion: 'catalog-v2' });

    expect(store.getState().snapshot).toEqual({
      ...createSnapshot(2, 'value-2'),
      catalogVersion: 'catalog-v2',
    });
    expect(store.didSettingChangeAfter('core.test.value', 1)).toBe(true);
    expect(store.didSettingChangeAfter('core.test.value', 2)).toBe(false);
    expect(getConfigSnapshot).toHaveBeenCalledTimes(1);
    expect(accepted.mock.calls.map(([update]) => update.snapshot.revision)).toEqual([1, 2]);
    expect(accepted.mock.calls[1][0].changedSettingIds).toEqual(['core.test.value']);
  });

  it('refreshes the whole snapshot when an event revision jumps', async () => {
    const getConfigSnapshot = vi.fn()
      .mockResolvedValueOnce(createSnapshot(1, 'value-1'))
      .mockResolvedValueOnce(createSnapshot(3, 'snapshot-value-3'));
    const harness = createTransport(getConfigSnapshot);
    const store = new ConfigSnapshotStore(harness.transport);
    const accepted = vi.fn();
    store.subscribeAccepted(accepted);

    await store.start();
    harness.emit(createEvent(3, 'event-value-3'));

    await vi.waitFor(() => expect(store.getState().snapshot?.revision).toBe(3));
    expect(store.getState().snapshot?.values['core.test.value']).toEqual({
      kind: 'value',
      value: 'snapshot-value-3',
    });
    expect(getConfigSnapshot).toHaveBeenCalledTimes(2);
    expect(store.didSettingChangeAfter('core.test.value', 1)).toBe(true);
    expect(accepted.mock.calls.map(([update]) => update.snapshot.revision)).toEqual([1, 3]);
    expect(accepted.mock.calls[1][0]).toMatchObject({
      previous: { revision: 1 },
      snapshot: { revision: 3 },
      changedSettingIds: ['core.test.value'],
    });
  });

  it('accepts out-of-order raw events only in contiguous revision order', async () => {
    const gapRefresh = deferred<ConfigSnapshot>();
    const getConfigSnapshot = vi.fn()
      .mockResolvedValueOnce(createSnapshot(1, 'value-1'))
      .mockReturnValueOnce(gapRefresh.promise);
    const harness = createTransport(getConfigSnapshot);
    const store = new ConfigSnapshotStore(harness.transport);

    await store.start();
    const accepted = vi.fn();
    store.subscribeAccepted(accepted);

    harness.emit(createEvent(3, 'value-3'));
    harness.emit(createEvent(2, 'value-2'));
    gapRefresh.resolve(createSnapshot(1, 'value-1'));

    await vi.waitFor(() => expect(store.getState().snapshot?.revision).toBe(3));
    expect(accepted.mock.calls.map(([update]) => update.snapshot.revision)).toEqual([2, 3]);
    expect(accepted.mock.calls.map(([update]) => (
      update.snapshot.values['core.test.value'] as { kind: 'value'; value: string }
    ).value)).toEqual(['value-2', 'value-3']);
  });

  it('queues an event that arrives during refresh and refetches if the first snapshot still has a gap', async () => {
    const initial = deferred<ConfigSnapshot>();
    const getConfigSnapshot = vi.fn()
      .mockReturnValueOnce(initial.promise)
      .mockResolvedValueOnce(createSnapshot(3, 'snapshot-value-3'));
    const harness = createTransport(getConfigSnapshot);
    const store = new ConfigSnapshotStore(harness.transport);

    const startPromise = store.start();
    harness.emit(createEvent(3, 'event-value-3'));
    initial.resolve(createSnapshot(1, 'value-1'));
    await startPromise;

    await vi.waitFor(() => expect(store.getState().snapshot?.revision).toBe(3));
    expect(getConfigSnapshot).toHaveBeenCalledTimes(2);
  });

  it('accepts an authoritative snapshot emitted after the desktop commit bridge lags', async () => {
    const getConfigSnapshot = vi.fn(async () => createSnapshot(1, 'value-1'));
    const harness = createTransport(getConfigSnapshot);
    const store = new ConfigSnapshotStore(harness.transport);
    const accepted = vi.fn();
    store.subscribeAccepted(accepted);

    await store.start();
    harness.emitSnapshotRefreshed({
      ...createSnapshot(8, 'snapshot-value-8'),
      catalogVersion: 'catalog-v8',
    });

    expect(store.getState().snapshot).toEqual({
      ...createSnapshot(8, 'snapshot-value-8'),
      catalogVersion: 'catalog-v8',
    });
    expect(getConfigSnapshot).toHaveBeenCalledTimes(1);
    expect(accepted.mock.calls.map(([update]) => update.snapshot.revision)).toEqual([1, 8]);
    expect(accepted.mock.calls[1][0]).toMatchObject({
      previous: { revision: 1 },
      snapshot: { revision: 8, catalogVersion: 'catalog-v8' },
      changedSettingIds: ['core.test.value'],
    });
  });

  it('ignores stale events and releases the event subscription on stop', async () => {
    const getConfigSnapshot = vi.fn(async () => createSnapshot(2, 'value-2'));
    const harness = createTransport(getConfigSnapshot);
    const store = new ConfigSnapshotStore(harness.transport);

    await store.start();
    const accepted = vi.fn();
    store.subscribeAccepted(accepted);
    harness.emit(createEvent(1, 'stale'));
    harness.emit(createEvent(2, 'duplicate'));
    store.stop();

    expect(store.getState().snapshot).toEqual(createSnapshot(2, 'value-2'));
    expect(accepted).not.toHaveBeenCalled();
    expect(harness.unlistenCommitted).toHaveBeenCalledTimes(1);
    expect(harness.unlistenSnapshotRefreshed).toHaveBeenCalledTimes(1);
  });
});
