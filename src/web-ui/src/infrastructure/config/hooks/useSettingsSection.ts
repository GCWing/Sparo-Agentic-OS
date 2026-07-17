import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ConfigStoredValue, JsonValue, SettingDescriptor } from '../catalog/types';
import { configCatalogStore } from '../catalog/ConfigCatalogStore';
import { configSnapshotStore } from '../snapshot/ConfigSnapshotStore';

export interface SettingsSectionEntry {
  descriptor: SettingDescriptor;
  storedValue: ConfigStoredValue | undefined;
  value: JsonValue | undefined;
  configured: boolean | undefined;
}

export interface UseSettingsSectionOptions {
  categoryId?: string;
  tabId?: string;
}

export interface UseSettingsSectionResult {
  settings: readonly SettingsSectionEntry[];
  revision: number | undefined;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useSettingsSection(
  sectionId: string,
  options: UseSettingsSectionOptions = {},
): UseSettingsSectionResult {
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

  useEffect(() => {
    void Promise.all([configCatalogStore.load(), configSnapshotStore.start()])
      .then(([catalog, snapshot]) => {
        if (catalog.version !== snapshot.catalogVersion) {
          return configCatalogStore.ensureVersion(snapshot.catalogVersion);
        }
        return catalog;
      })
      .catch(() => undefined);
  }, []);

  const refresh = useCallback(async () => {
    const snapshot = await configSnapshotStore.refresh();
    await configCatalogStore.ensureVersion(snapshot.catalogVersion);
  }, []);

  const settings = useMemo<readonly SettingsSectionEntry[]>(() => {
    const values = snapshotState.snapshot?.values ?? {};
    return (catalogState.catalog?.settings ?? [])
      .filter((descriptor) =>
        descriptor.presentation.sectionId === sectionId
        && (!options.categoryId || descriptor.presentation.categoryId === options.categoryId)
        && (!options.tabId || descriptor.presentation.tabId === options.tabId)
        && !descriptor.presentation.hidden,
      )
      .sort((left, right) => left.presentation.order - right.presentation.order)
      .map((descriptor) => {
        const storedValue = values[descriptor.id];
        return {
          descriptor,
          storedValue,
          value: storedValue?.kind === 'value' ? storedValue.value : undefined,
          configured: storedValue?.kind === 'secret' ? storedValue.configured : undefined,
        };
      });
  }, [
    catalogState.catalog,
    options.categoryId,
    options.tabId,
    sectionId,
    snapshotState.snapshot?.values,
  ]);

  return {
    settings,
    revision: snapshotState.snapshot?.revision,
    isLoading:
      catalogState.status === 'idle'
      || catalogState.status === 'loading'
      || snapshotState.status === 'idle'
      || snapshotState.status === 'loading',
    error: snapshotState.error ?? catalogState.error,
    refresh,
  };
}
