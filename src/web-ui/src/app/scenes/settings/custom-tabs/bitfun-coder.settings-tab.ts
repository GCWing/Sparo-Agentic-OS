import { lazy } from 'react';
import { defineCustomSettingsTab } from '../customSettingsRegistration';

export default defineCustomSettingsTab({
  id: 'bitfunCoder',
  categoryId: 'productApps',
  categoryOrder: 300,
  order: 100,
  aliases: ['bitfun coder', 'debug', 'ingest', 'instrumentation', 'log template'],
  claimedSettingNamespaces: ['core.product_apps.bitfun_coder.debug'],
  draftSettingIds: [
    'core.product_apps.bitfun_coder.debug.log_path',
    'core.product_apps.bitfun_coder.debug.ingest_port',
    'core.product_apps.bitfun_coder.debug.enabled_languages',
    'core.product_apps.bitfun_coder.debug.language_templates',
  ],
  actions: [
    {
      id: 'bitfun-coder.select-log-path',
      labelKey: 'settings/debug:settings.logPath.browse',
      aliases: ['debug log', 'log file'],
    },
    {
      id: 'bitfun-coder.reset-templates',
      labelKey: 'settings/debug:templates.reset',
      aliases: ['default templates', 'instrumentation templates'],
    },
  ],
  component: lazy(() => import('@/infrastructure/config/components/BitFunCoderConfig')),
});
