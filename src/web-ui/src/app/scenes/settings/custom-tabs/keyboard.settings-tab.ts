import { lazy } from 'react';
import { defineCustomSettingsTab } from '../customSettingsRegistration';

export default defineCustomSettingsTab({
  id: 'keyboard',
  categoryId: 'general',
  categoryOrder: 100,
  order: 400,
  aliases: ['shortcut', 'keybinding', 'hotkey', 'keys'],
  claimedSettingNamespaces: ['core.app.keybindings'],
  draftSettingIds: ['core.app.keybindings'],
  actions: [
    {
      id: 'keyboard.apply',
      labelKey: 'settings/keyboard:apply',
      aliases: ['save shortcuts', 'apply keybindings'],
    },
    {
      id: 'keyboard.reset',
      labelKey: 'settings/keyboard:reset',
      aliases: ['default shortcuts', 'clear keybindings'],
    },
  ],
  component: lazy(() => import('../components/KeyboardShortcutsTab')),
});
