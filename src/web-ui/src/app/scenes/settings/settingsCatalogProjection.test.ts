import { describe, expect, it } from 'vitest';
import type { SettingDescriptor } from '@/infrastructure/config';
import { isManualSettingVisible } from './settingsCatalogProjection';

function descriptor(aiReadable: boolean, hidden: boolean): SettingDescriptor {
  return {
    id: aiReadable ? 'core.app.language' : 'core.advanced.future',
    exposure: aiReadable ? 'formal' : 'binding',
    valueSchema: { type: 'boolean' },
    defaultValue: { kind: 'value', value: false },
    presentation: {
      categoryId: 'advanced',
      tabId: 'future',
      sectionId: 'advanced-future',
      fieldId: 'setting',
      titleKey: 'future.setting',
      control: 'switch',
      order: 10_000,
      hidden,
    },
    ai: { aliases: [], tags: [], readable: aiReadable, writable: aiReadable },
    policy: {
      risk: 'safe',
      sensitivity: 'public',
      mutability: 'writable',
      applyStrategy: 'reactive',
    },
    source: { kind: 'core' },
  };
}

describe('manual Catalog projection', () => {
  it('shows an automatically derived advanced setting without publishing it to AI', () => {
    expect(isManualSettingVisible(descriptor(false, false))).toBe(true);
  });

  it('honors the explicit presentation visibility boundary', () => {
    expect(isManualSettingVisible(descriptor(true, true))).toBe(false);
  });
});
