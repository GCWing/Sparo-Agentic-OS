import { describe, expect, it } from 'vitest';
import type { SettingDescriptor, SettingsSectionRef } from '@/infrastructure/config';
import {
  CUSTOM_SETTINGS_TABS,
  getCustomTabsForSections,
  getScopedCustomTabsForSections,
  getSettingIdsForCustomTabSections,
  isDescriptorClaimedByCustomTab,
  removeCustomClaimsFromSections,
} from './customSettingsRegistry';
import {
  diffCustomSettingsDirtyIds,
  normalizeCustomSettingsDirtyIds,
} from './customSettingsRegistration';

function descriptor(
  id: string,
  tabId: string,
  sectionId: string,
  fieldId: string,
): SettingDescriptor {
  return {
    id,
    exposure: 'formal',
    valueSchema: { type: 'string' },
    defaultValue: { kind: 'value', value: '' },
    presentation: {
      categoryId: 'advanced',
      tabId,
      sectionId,
      fieldId,
      titleKey: id,
      control: 'text',
      order: 10_000,
      hidden: false,
    },
    ai: { aliases: [], tags: [], readable: true, writable: true },
    policy: {
      risk: 'safe',
      sensitivity: 'public',
      mutability: 'writable',
      applyStrategy: 'reactive',
    },
    source: { kind: 'core' },
  };
}

function section(
  tabId: string,
  sectionId: string,
  fieldIds: string[],
): SettingsSectionRef {
  return { categoryId: 'advanced', tabId, sectionId, fieldIds };
}

describe('custom settings projection registry', () => {
  it('keeps every still-required rich settings experience in one registry', () => {
    expect(CUSTOM_SETTINGS_TABS.map((tab) => tab.id)).toEqual([
      'basics',
      'appearance',
      'models',
      'keyboard',
      'personalization',
      'voiceInput',
      'permissions',
      'memory',
      'bitfunCoder',
      'editor',
      'aiUsage',
      'dataStorage',
    ]);
  });

  it('maps an advanced AI descriptor back to its real model-management projection', () => {
    const model = descriptor(
      'core.ai.models',
      'ai',
      'advanced-ai',
      'models',
    );
    const affected = section('ai', 'advanced-ai', ['models']);

    expect(getCustomTabsForSections([affected], [model]).map((tab) => tab.id))
      .toEqual(['models']);
    expect(removeCustomClaimsFromSections(
      [affected],
      [model],
      getCustomTabsForSections([affected], [model]),
    )).toEqual([]);
  });

  it('uses stable setting ownership even when presentation points at another tab', () => {
    const language = descriptor(
      'core.app.language',
      'basics',
      'language',
      'language',
    );

    expect(getCustomTabsForSections(
      [section('basics', 'language', ['language'])],
      [language],
    ).map((tab) => tab.id)).toEqual(['appearance']);
  });

  it.each([
    ['core.themes.current', 'themes', 'current', 'appearance'],
    ['core.font.ui_size.level', 'font', 'level', 'appearance'],
    [
      'core.app.ai_experience.enable_agent_companion',
      'app',
      'enable-agent-companion',
      'personalization',
    ],
    [
      'core.app.ai_experience.voice_input.enabled',
      'app',
      'enabled',
      'voiceInput',
    ],
  ])('maps stable setting %s to %s custom projection', (
    settingId,
    tabId,
    fieldId,
    expectedTab,
  ) => {
    const setting = descriptor(
      settingId,
      tabId,
      `advanced-${tabId}`,
      fieldId,
    );

    expect(getCustomTabsForSections(
      [section(tabId, `advanced-${tabId}`, [fieldId])],
      [setting],
    ).map((tab) => tab.id)).toEqual([expectedTab]);
  });

  it('can own a stable presentation section without reading storage metadata', () => {
    const logLevel = descriptor(
      'core.app.logging.level',
      'basics',
      'logging',
      'log-level',
    );

    expect(isDescriptorClaimedByCustomTab(logLevel)).toBe(true);
    expect(getCustomTabsForSections(
      [section('basics', 'logging', ['log-level'])],
      [logLevel],
    ).map((tab) => tab.id)).toEqual(['basics']);
  });

  it('keeps unclaimed advanced settings in the generic Catalog fallback', () => {
    const futureSetting = descriptor(
      'core.ai.future_setting',
      'ai',
      'advanced-ai',
      'future-setting',
    );
    const affected = section('ai', 'advanced-ai', ['future-setting']);

    expect(isDescriptorClaimedByCustomTab(futureSetting)).toBe(false);
    expect(getCustomTabsForSections([affected], [futureSetting])).toEqual([]);
    expect(removeCustomClaimsFromSections([affected], [futureSetting], [])).toEqual([affected]);
  });

  it('does not let a custom tab swallow a newly declared descendant', () => {
    const futureEditorSetting = descriptor(
      'core.editor.future_assist',
      'editor',
      'advanced-editor',
      'future-assist',
    );
    const affected = section('editor', 'advanced-editor', ['future-assist']);

    expect(isDescriptorClaimedByCustomTab(futureEditorSetting)).toBe(false);
    expect(removeCustomClaimsFromSections([affected], [futureEditorSetting], []))
      .toEqual([affected]);
  });

  it('projects action-only affected tabs without inventing a Catalog value', () => {
    const affected = section('voiceInput', 'model-management', []);

    expect(getCustomTabsForSections([affected], []).map((tab) => tab.id))
      .toEqual(['voiceInput']);
    expect(removeCustomClaimsFromSections(
      [affected],
      [],
      getCustomTabsForSections([affected], []),
    )).toEqual([]);
  });

  it('mounts rich result projections only when the custom tab honors exact setting IDs', () => {
    const font = descriptor(
      'core.font.ui_size.level',
      'appearance',
      'font-size',
      'ui-font-size',
    );
    const affected = section('appearance', 'font-size', ['ui-font-size']);
    const scopedTabs = getScopedCustomTabsForSections([affected], [font]);

    expect(scopedTabs.map((tab) => tab.id)).toEqual(['appearance']);
    expect(getSettingIdsForCustomTabSections(scopedTabs[0]!, [affected], [font]))
      .toEqual(['core.font.ui_size.level']);
    expect(removeCustomClaimsFromSections([affected], [font], scopedTabs)).toEqual([]);
  });

  it('falls back to exact Catalog fields instead of mounting an unrelated full custom page', () => {
    const model = descriptor('core.ai.models', 'ai', 'advanced-ai', 'models');
    const affected = section('ai', 'advanced-ai', ['models']);
    const scopedTabs = getScopedCustomTabsForSections([affected], [model]);

    expect(scopedTabs).toEqual([]);
    expect(removeCustomClaimsFromSections([affected], [model], scopedTabs)).toEqual([affected]);
  });

  it('accepts only exact declared draft setting IDs, never a tab or namespace shortcut', () => {
    const editor = CUSTOM_SETTINGS_TABS.find((tab) => tab.id === 'editor');
    expect(editor).toBeDefined();

    expect(normalizeCustomSettingsDirtyIds(editor!, [
      'core.editor.minimap.side',
      'core.editor.font_size',
      'core.editor.font_size',
    ])).toEqual([
      'core.editor.font_size',
      'core.editor.minimap.side',
    ]);
    expect(() => normalizeCustomSettingsDirtyIds(editor!, ['core.editor']))
      .toThrow('reported undeclared dirty setting core.editor');
  });

  it('diffs dirty state per setting instead of replacing the whole custom tab', () => {
    expect(diffCustomSettingsDirtyIds(
      new Set(['core.ai.proxy']),
      new Set(['core.ai.stream_idle_timeout_secs']),
    )).toEqual({
      added: ['core.ai.stream_idle_timeout_secs'],
      removed: ['core.ai.proxy'],
    });
  });
});
