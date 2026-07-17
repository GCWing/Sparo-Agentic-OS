import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { configCatalogStore } from '../catalog/ConfigCatalogStore';
import { configSnapshotStore } from '../snapshot/ConfigSnapshotStore';
import {
  AI_EXPERIENCE_SETTING_NAMESPACE,
  type AIExperienceSettings,
} from '../services/AIExperienceConfigService';
import { projectSettingValue } from '../services/ConfigManager';

export interface UseAIExperienceSettingsResult {
  settings: AIExperienceSettings | null;
  isLoading: boolean;
  error: Error | null;
}

export function useAIExperienceSettings(): UseAIExperienceSettingsResult {
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
      .catch(() => undefined);
  }, []);

  const projection = useMemo((): {
    settings: AIExperienceSettings | null;
    error: Error | null;
  } => {
    const catalog = catalogState.catalog;
    const snapshot = snapshotState.snapshot;
    if (!catalog || !snapshot || catalog.version !== snapshot.catalogVersion) {
      return { settings: null, error: null };
    }

    try {
      const settings = projectSettingValue<AIExperienceSettings>(
        catalog,
        snapshot,
        AI_EXPERIENCE_SETTING_NAMESPACE,
      );
      if (!settings) {
        throw new Error(
          `Config catalog does not define "${AI_EXPERIENCE_SETTING_NAMESPACE}"`,
        );
      }
      return { settings, error: null };
    } catch (error) {
      return {
        settings: null,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }, [catalogState.catalog, snapshotState.snapshot]);

  const isLoading = (
    catalogState.status === 'idle'
    || catalogState.status === 'loading'
    || snapshotState.status === 'idle'
    || snapshotState.status === 'loading'
    || !catalogState.catalog
    || !snapshotState.snapshot
    || catalogState.catalog.version !== snapshotState.snapshot.catalogVersion
  ) && !catalogState.error && !snapshotState.error;

  return {
    settings: projection.settings,
    isLoading,
    error: snapshotState.error ?? catalogState.error ?? projection.error,
  };
}
