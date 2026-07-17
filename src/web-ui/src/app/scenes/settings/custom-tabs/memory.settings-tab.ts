import { lazy } from 'react';
import { defineCustomSettingsTab } from '../customSettingsRegistration';

export default defineCustomSettingsTab({
  id: 'memory',
  categoryId: 'smartCapabilities',
  categoryOrder: 200,
  order: 400,
  aliases: ['memory', 'auto memory', 'extract memory', 'host scan'],
  claimedSettingNamespaces: [
    'core.ai.auto_memory.global',
    'core.ai.auto_memory.workspace',
    'core.app.host_scan',
  ],
  actions: [
    {
      id: 'memory.reset',
      labelKey: 'settings/memory:actions.resetAll',
      aliases: ['default memory settings', 'reset auto memory'],
    },
  ],
  component: lazy(() => import('@/infrastructure/config/components/MemoryConfig')),
});
