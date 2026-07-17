import { lazy } from 'react';
import { defineCustomSettingsTab } from '../customSettingsRegistration';

export default defineCustomSettingsTab({
  id: 'personalization',
  categoryId: 'smartCapabilities',
  categoryOrder: 200,
  order: 100,
  aliases: ['personalization', 'session title', 'agent companion', 'pet', 'thinking'],
  claimedSettingNamespaces: [
    'core.ai.agent_models',
    'core.ai.func_agent_models',
    'core.app.ai_experience.enable_daily_letter',
    'core.app.ai_experience.enable_session_title_generation',
    'core.app.ai_experience.enable_agent_companion',
    'core.app.ai_experience.agent_companion_pet',
    'core.app.ai_experience.show_thinking_process',
    'core.app.ai_experience.show_completed_thinking_item',
  ],
  actions: [
    {
      id: 'personalization.import-companion',
      labelKey: 'settings/personalization:features.agentCompanion.import',
      aliases: ['pet', 'petdex', 'companion appearance'],
    },
    {
      id: 'personalization.delete-companion',
      labelKey: 'settings/personalization:features.agentCompanion.delete',
      aliases: ['remove pet', 'delete pet'],
    },
  ],
  component: lazy(() => import('@/infrastructure/config/components/PersonalizationConfig')),
});
