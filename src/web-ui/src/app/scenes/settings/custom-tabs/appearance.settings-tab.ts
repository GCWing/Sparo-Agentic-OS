import { lazy } from 'react';
import { defineCustomSettingsTab } from '../customSettingsRegistration';

export default defineCustomSettingsTab({
  id: 'appearance',
  categoryId: 'general',
  categoryOrder: 100,
  order: 200,
  aliases: ['theme', 'language', 'locale', 'font', 'interface'],
  claimedSettingNamespaces: ['core.app.language', 'core.themes', 'core.font'],
  supportsScopedProjection: true,
  actions: [
    {
      id: 'appearance.reset-font',
      labelKey: 'settings/appearance:appearance.fontSize.resetButton',
      aliases: ['reset font', 'default font'],
    },
  ],
  component: lazy(() => import('@/infrastructure/config/components/AppearanceConfig')),
});
