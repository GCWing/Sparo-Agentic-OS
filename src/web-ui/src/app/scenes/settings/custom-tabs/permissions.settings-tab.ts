import { lazy } from 'react';
import { defineCustomSettingsTab } from '../customSettingsRegistration';

export default defineCustomSettingsTab({
  id: 'permissions',
  categoryId: 'smartCapabilities',
  categoryOrder: 200,
  order: 300,
  aliases: ['permission', 'tool confirmation', 'computer use', 'browser control', 'timeout'],
  claimedSettingNamespaces: [
    'core.ai.skip_tool_confirmation',
    'core.ai.tool_execution_timeout_secs',
    'core.ai.tool_confirmation_timeout_secs',
    'core.ai.goal_mode.max_continuation_turns',
    'core.ai.computer_use_enabled',
  ],
  actions: [
    {
      id: 'permissions.open-system-settings',
      labelKey: 'settings/permissions:computerUse.openSettings',
      aliases: ['accessibility', 'screen recording', 'system permission'],
    },
    {
      id: 'permissions.connect-browser',
      labelKey: 'settings/permissions:browserControl.connect',
      aliases: ['cdp', 'browser debugging', 'browser tabs'],
    },
  ],
  component: lazy(() => import('@/infrastructure/config/components/PermissionsConfig')),
});
