import type { DebugModeConfig } from '../types';

const DEBUG_SETTING_ID_BY_FIELD: Readonly<Record<keyof DebugModeConfig, string>> = {
  log_path: 'core.product_apps.bitfun_coder.debug.log_path',
  ingest_port: 'core.product_apps.bitfun_coder.debug.ingest_port',
  enabled_languages: 'core.product_apps.bitfun_coder.debug.enabled_languages',
  language_templates: 'core.product_apps.bitfun_coder.debug.language_templates',
};

export function getDebugSettingId(field: keyof DebugModeConfig): string {
  return DEBUG_SETTING_ID_BY_FIELD[field];
}

/** Preserve exact local draft fields while accepting all other committed fields. */
export function mergeDebugSettingsProjection(
  draft: DebugModeConfig,
  committed: DebugModeConfig,
  dirtySettingIds: ReadonlySet<string>,
): DebugModeConfig {
  return {
    log_path: dirtySettingIds.has(getDebugSettingId('log_path'))
      ? draft.log_path
      : committed.log_path,
    ingest_port: dirtySettingIds.has(getDebugSettingId('ingest_port'))
      ? draft.ingest_port
      : committed.ingest_port,
    enabled_languages: dirtySettingIds.has(getDebugSettingId('enabled_languages'))
      ? draft.enabled_languages
      : committed.enabled_languages,
    language_templates: dirtySettingIds.has(getDebugSettingId('language_templates'))
      ? draft.language_templates
      : committed.language_templates,
  };
}
