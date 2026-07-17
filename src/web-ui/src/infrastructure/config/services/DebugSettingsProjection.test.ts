import { describe, expect, it } from 'vitest';
import type { DebugModeConfig } from '../types';
import {
  getDebugSettingId,
  mergeDebugSettingsProjection,
} from './DebugSettingsProjection';

function debugConfig(overrides: Partial<DebugModeConfig> = {}): DebugModeConfig {
  return {
    log_path: 'old.log',
    ingest_port: 7242,
    enabled_languages: ['typescript'],
    language_templates: {},
    ...overrides,
  };
}

describe('mergeDebugSettingsProjection', () => {
  it('does not freeze non-dirty fields when one debug setting has a draft', () => {
    const draft = debugConfig({ log_path: 'draft.log' });
    const committed = debugConfig({ log_path: 'remote.log', ingest_port: 8000 });

    expect(mergeDebugSettingsProjection(
      draft,
      committed,
      new Set([getDebugSettingId('log_path')]),
    )).toMatchObject({
      log_path: 'draft.log',
      ingest_port: 8000,
    });
  });
});
