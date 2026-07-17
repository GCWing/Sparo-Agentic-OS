import { lazy } from 'react';
import { defineCustomSettingsTab } from '../customSettingsRegistration';

export default defineCustomSettingsTab({
  id: 'dataStorage',
  categoryId: 'data',
  categoryOrder: 400,
  order: 200,
  aliases: ['storage', 'data', 'cache', 'cleanup', 'factory reset'],
  actions: [
    {
      id: 'data-storage.open-location',
      labelKey: 'settings/data-storage:actions.openFolderTooltip',
      aliases: ['data folder', 'storage location'],
    },
    {
      id: 'data-storage.reset',
      labelKey: 'settings/data-storage:actions.reset',
      aliases: ['cleanup', 'factory reset', 'clear cache', 'erase app data'],
    },
  ],
  component: lazy(() => import('@/infrastructure/config/components/DataStorageConfig')),
});
