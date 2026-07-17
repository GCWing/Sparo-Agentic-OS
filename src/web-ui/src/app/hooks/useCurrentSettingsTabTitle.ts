import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { configCatalogStore } from '@/infrastructure/config';
import { useSettingsStore } from '../scenes/settings/settingsStore';

function humanizeId(value: string): string {
  return value
    .replace(/[-_.]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function useCurrentSettingsTabTitle(): string {
  const { t } = useTranslation('settings/config-center');
  const activeTab = useSettingsStore((state) => state.activeTab);
  const catalogState = useSyncExternalStore(
    configCatalogStore.subscribe,
    configCatalogStore.getState,
    configCatalogStore.getState,
  );

  useEffect(() => {
    void configCatalogStore.load().catch(() => undefined);
  }, []);

  return useMemo(() => {
    const exists = catalogState.catalog?.settings.some(
      (descriptor) => descriptor.presentation.tabId === activeTab,
    );
    if (!exists) {
      return '';
    }
    return t(`tabs.${activeTab}`, { defaultValue: humanizeId(activeTab) });
  }, [activeTab, catalogState.catalog, t]);
}
