import type { EditorConfig } from '../types';

type PersistedEditorConfigKeys =
  | 'font_size'
  | 'font_family'
  | 'line_height'
  | 'tab_size'
  | 'insert_spaces'
  | 'word_wrap'
  | 'line_numbers'
  | 'theme'
  | 'auto_save'
  | 'auto_save_delay'
  | 'format_on_save'
  | 'format_on_paste'
  | 'trim_auto_whitespace';

export type EditorSettingsProjection = Pick<EditorConfig, PersistedEditorConfigKeys> & {
  minimap: {
    enabled: boolean;
    side: string;
    size: string;
  };
};

export type EditorSettingsDraftPath = PersistedEditorConfigKeys
  | 'minimap.enabled'
  | 'minimap.side'
  | 'minimap.size';

const EDITOR_SETTING_ID_BY_PATH: Readonly<Record<EditorSettingsDraftPath, string>> = {
  font_size: 'core.editor.font_size',
  font_family: 'core.editor.font_family',
  line_height: 'core.editor.line_height',
  tab_size: 'core.editor.tab_size',
  insert_spaces: 'core.editor.insert_spaces',
  word_wrap: 'core.editor.word_wrap',
  line_numbers: 'core.editor.line_numbers',
  theme: 'core.editor.theme',
  auto_save: 'core.editor.auto_save',
  auto_save_delay: 'core.editor.auto_save_delay',
  format_on_save: 'core.editor.format_on_save',
  format_on_paste: 'core.editor.format_on_paste',
  trim_auto_whitespace: 'core.editor.trim_auto_whitespace',
  'minimap.enabled': 'core.editor.minimap.enabled',
  'minimap.side': 'core.editor.minimap.side',
  'minimap.size': 'core.editor.minimap.size',
};

export function getEditorSettingId(path: EditorSettingsDraftPath): string {
  return EDITOR_SETTING_ID_BY_PATH[path];
}

/** Preserve only local draft fields while accepting every other committed field. */
export function mergeEditorSettingsProjection(
  draft: EditorSettingsProjection,
  committed: EditorSettingsProjection,
  dirtySettingIds: ReadonlySet<string>,
): EditorSettingsProjection {
  const merged = {
    ...committed,
    minimap: { ...committed.minimap },
  };
  const mergedRecord = merged as unknown as Record<string, unknown>;
  const draftRecord = draft as unknown as Record<string, unknown>;

  for (const path of Object.keys(EDITOR_SETTING_ID_BY_PATH) as EditorSettingsDraftPath[]) {
    if (!dirtySettingIds.has(getEditorSettingId(path))) {
      continue;
    }
    if (path.startsWith('minimap.')) {
      const key = path.slice('minimap.'.length) as keyof EditorSettingsProjection['minimap'];
      const mergedMinimap = merged.minimap as unknown as Record<string, string | boolean>;
      mergedMinimap[key] = draft.minimap[key];
    } else {
      mergedRecord[path] = draftRecord[path];
    }
  }
  return merged;
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Catalog projection is missing ${path}`);
  }
  return value as Record<string, unknown>;
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  path = `editor.${key}`,
): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new Error(`Catalog projection is missing ${path}`);
  }
  return value;
}

function requireNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Catalog projection is missing editor.${key}`);
  }
  return value;
}

function requireBoolean(
  record: Record<string, unknown>,
  key: string,
  path = `editor.${key}`,
): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    throw new Error(`Catalog projection is missing ${path}`);
  }
  return value;
}

/**
 * Narrows the authoritative Catalog + Snapshot projection to the fields owned
 * by Core's persisted editor settings contract. Runtime-only Monaco defaults
 * deliberately do not participate in the settings surface.
 */
export function parseEditorSettingsProjection(value: unknown): EditorSettingsProjection {
  const config = requireRecord(value, 'editor');
  const minimap = requireRecord(config.minimap, 'editor.minimap');

  return {
    font_size: requireNumber(config, 'font_size'),
    font_family: requireString(config, 'font_family'),
    line_height: requireNumber(config, 'line_height'),
    tab_size: requireNumber(config, 'tab_size'),
    insert_spaces: requireBoolean(config, 'insert_spaces'),
    word_wrap: requireString(config, 'word_wrap'),
    line_numbers: requireString(config, 'line_numbers'),
    minimap: {
      enabled: requireBoolean(minimap, 'enabled', 'editor.minimap.enabled'),
      side: requireString(minimap, 'side', 'editor.minimap.side'),
      size: requireString(minimap, 'size', 'editor.minimap.size'),
    },
    theme: requireString(config, 'theme'),
    auto_save: requireString(config, 'auto_save'),
    auto_save_delay: requireNumber(config, 'auto_save_delay'),
    format_on_save: requireBoolean(config, 'format_on_save'),
    format_on_paste: requireBoolean(config, 'format_on_paste'),
    trim_auto_whitespace: requireBoolean(config, 'trim_auto_whitespace'),
  };
}
