import { lazy } from 'react';
import { defineCustomSettingsTab } from '../customSettingsRegistration';

export default defineCustomSettingsTab({
  id: 'aiUsage',
  categoryId: 'data',
  categoryOrder: 400,
  order: 100,
  aliases: ['ai usage', 'tokens', 'cost', 'analytics', 'history'],
  actions: [
    {
      id: 'ai-usage.reset-history',
      labelKey: 'settings/ai-usage:actions.reset',
      aliases: ['clear token usage', 'delete usage history'],
    },
  ],
  component: lazy(() => import('@/infrastructure/config/components/AIUsageConfig')),
});
