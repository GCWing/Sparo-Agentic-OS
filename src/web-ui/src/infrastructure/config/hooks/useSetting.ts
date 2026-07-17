import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type {
  ConfigStoredValue,
  JsonValue,
  SettingDescriptor,
} from '../catalog/types';
import { configCatalogStore } from '../catalog/ConfigCatalogStore';
import { configSnapshotStore } from '../snapshot/ConfigSnapshotStore';
import {
  ConfigConfirmationRequiredError,
  configTransactionClient,
  createConfigRequestId,
} from '../transaction/ConfigTransactionClient';
import type {
  CommitConfigPatchRequest,
  ConfigCommit,
  ConfigPatchOperation,
  ConfigPlan,
} from '../transaction/types';

export interface PlannedSettingChange {
  plan: ConfigPlan;
  commitRequest: Omit<CommitConfigPatchRequest, 'planId' | 'confirmed'>;
}

export interface UseSettingResult<T extends JsonValue> {
  descriptor: SettingDescriptor | undefined;
  storedValue: ConfigStoredValue | undefined;
  value: T | undefined;
  configured: boolean | undefined;
  revision: number | undefined;
  isLoading: boolean;
  isSaving: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  planValue: (value: T) => Promise<PlannedSettingChange>;
  planReset: () => Promise<PlannedSettingChange>;
  commitPlanned: (planned: PlannedSettingChange, confirmed?: boolean) => Promise<ConfigCommit>;
  setValue: (value: T) => Promise<ConfigCommit>;
  reset: () => Promise<ConfigCommit>;
  undo: (commitId: string, undoToken: string, confirmed?: boolean) => Promise<ConfigCommit>;
}

export function useSetting<T extends JsonValue = JsonValue>(
  settingId: string,
): UseSettingResult<T> {
  const catalogState = useSyncExternalStore(
    configCatalogStore.subscribe,
    configCatalogStore.getState,
    configCatalogStore.getState,
  );
  const snapshotState = useSyncExternalStore(
    configSnapshotStore.subscribe,
    configSnapshotStore.getState,
    configSnapshotStore.getState,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [mutationError, setMutationError] = useState<Error | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([configCatalogStore.load(), configSnapshotStore.start()])
      .then(([catalog, snapshot]) => {
        if (active && catalog.version !== snapshot.catalogVersion) {
          return configCatalogStore.ensureVersion(snapshot.catalogVersion);
        }
        return catalog;
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const descriptor = configCatalogStore.getDescriptor(settingId);
  const storedValue = snapshotState.snapshot?.values[settingId];
  const value = storedValue?.kind === 'value' ? storedValue.value as T : undefined;
  const configured = storedValue?.kind === 'secret' ? storedValue.configured : undefined;

  const refresh = useCallback(async () => {
    const snapshot = await configSnapshotStore.refresh();
    await configCatalogStore.ensureVersion(snapshot.catalogVersion);
  }, []);

  const planOperation = useCallback(async (
    operation: ConfigPatchOperation,
  ): Promise<PlannedSettingChange> => {
    const snapshot = configSnapshotStore.getState().snapshot ?? await configSnapshotStore.start();
    const requestId = createConfigRequestId('config-plan');
    const idempotencyKey = createConfigRequestId('config-change');
    const plan = await configTransactionClient.plan({
      requestId,
      idempotencyKey,
      expectedRevision: snapshot.revision,
      scope: snapshot.scope,
      operations: [operation],
    });
    return {
      plan,
      commitRequest: {
        expectedRevision: plan.baseRevision,
        idempotencyKey,
      },
    };
  }, []);

  const planValue = useCallback(
    (nextValue: T) => planOperation({ op: 'set', settingId, value: nextValue }),
    [planOperation, settingId],
  );

  const planReset = useCallback(
    () => planOperation({ op: 'reset', settingId }),
    [planOperation, settingId],
  );

  const commitPlanned = useCallback(async (
    planned: PlannedSettingChange,
    confirmed = false,
  ): Promise<ConfigCommit> => {
    setIsSaving(true);
    setMutationError(null);
    try {
      const commit = await configTransactionClient.commit({
        ...planned.commitRequest,
        planId: planned.plan.planId,
        confirmed,
      });
      if ((configSnapshotStore.getState().snapshot?.revision ?? -1) < commit.revision) {
        await configSnapshotStore.refresh();
      }
      return commit;
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      setMutationError(resolvedError);
      throw resolvedError;
    } finally {
      setIsSaving(false);
    }
  }, []);

  const applyPlanned = useCallback(async (planned: PlannedSettingChange): Promise<ConfigCommit> => {
    if (planned.plan.requiresConfirmation) {
      throw new ConfigConfirmationRequiredError(planned.plan, planned.commitRequest);
    }
    return commitPlanned(planned);
  }, [commitPlanned]);

  const setValue = useCallback(async (nextValue: T): Promise<ConfigCommit> => {
    setMutationError(null);
    try {
      return await applyPlanned(await planValue(nextValue));
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      setMutationError(resolvedError);
      throw resolvedError;
    }
  }, [applyPlanned, planValue]);

  const reset = useCallback(async (): Promise<ConfigCommit> => {
    setMutationError(null);
    try {
      return await applyPlanned(await planReset());
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      setMutationError(resolvedError);
      throw resolvedError;
    }
  }, [applyPlanned, planReset]);

  const undo = useCallback(async (
    commitId: string,
    undoToken: string,
    confirmed = false,
  ): Promise<ConfigCommit> => {
    const snapshot = configSnapshotStore.getState().snapshot ?? await configSnapshotStore.start();
    setIsSaving(true);
    setMutationError(null);
    try {
      const commit = await configTransactionClient.undo({
        idempotencyKey: createConfigRequestId('config-undo'),
        commitId,
        undoToken,
        expectedRevision: snapshot.revision,
        confirmed,
      });
      if ((configSnapshotStore.getState().snapshot?.revision ?? -1) < commit.revision) {
        await configSnapshotStore.refresh();
      }
      return commit;
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      setMutationError(resolvedError);
      throw resolvedError;
    } finally {
      setIsSaving(false);
    }
  }, []);

  const error = mutationError ?? snapshotState.error ?? catalogState.error;

  return useMemo(() => ({
    descriptor,
    storedValue,
    value,
    configured,
    revision: snapshotState.snapshot?.revision,
    isLoading:
      catalogState.status === 'idle'
      || catalogState.status === 'loading'
      || snapshotState.status === 'idle'
      || snapshotState.status === 'loading',
    isSaving,
    error,
    refresh,
    planValue,
    planReset,
    commitPlanned,
    setValue,
    reset,
    undo,
  }), [
    catalogState.status,
    commitPlanned,
    configured,
    descriptor,
    error,
    isSaving,
    planReset,
    planValue,
    refresh,
    reset,
    setValue,
    snapshotState.snapshot?.revision,
    snapshotState.status,
    storedValue,
    undo,
    value,
  ]);
}
