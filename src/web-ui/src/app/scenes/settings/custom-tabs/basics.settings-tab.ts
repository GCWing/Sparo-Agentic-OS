import { lazy } from 'react';
import { defineCustomSettingsTab } from '../customSettingsRegistration';

export default defineCustomSettingsTab({
  id: 'basics',
  categoryId: 'general',
  categoryOrder: 100,
  order: 100,
  aliases: ['general', 'startup', 'logging', 'terminal', 'notifications', 'tray'],
  claimedSettingNamespaces: [
    'core.app.notifications.dialog_completion_notify',
    'core.app.notifications.enable_startup_tips',
    'core.app.tray.close_to_tray',
  ],
  claimedSections: [
    { tabId: 'basics', sectionId: 'logging' },
    { tabId: 'terminal', sectionId: 'shell' },
  ],
  actions: [
    {
      id: 'basics.launch-at-login',
      labelKey: 'settings/basics:launchAtLogin.toggleLabel',
      aliases: ['autostart', 'startup', 'login', 'boot'],
    },
    {
      id: 'basics.open-log-folder',
      labelKey: 'settings/basics:logging.actions.openFolder',
      aliases: ['logs', 'folder', 'directory'],
    },
  ],
  component: lazy(() => import('@/infrastructure/config/components/BasicsConfig')),
});
