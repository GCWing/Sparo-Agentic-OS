import { lazy } from 'react';
import { defineCustomSettingsTab } from '../customSettingsRegistration';

export default defineCustomSettingsTab({
  id: 'models',
  categoryId: 'general',
  categoryOrder: 100,
  order: 300,
  aliases: ['model', 'provider', 'api key', 'proxy', 'openai', 'claude'],
  claimedSettingNamespaces: [
    'core.ai.models',
    'core.ai.default_models',
    'core.ai.proxy',
    'core.ai.stream_idle_timeout_secs',
  ],
  draftSettingIds: [
    'core.ai.models',
    'core.ai.proxy',
    'core.ai.stream_idle_timeout_secs',
  ],
  actions: [
    {
      id: 'models.add-provider',
      labelKey: 'settings/ai-model:actions.addProvider',
      aliases: ['provider', 'api', 'credential'],
    },
    {
      id: 'models.test-connection',
      labelKey: 'settings/ai-model:actions.test',
      aliases: ['connection', 'verify provider'],
    },
  ],
  component: lazy(() => import('@/infrastructure/config/components/AIModelConfig')),
});
