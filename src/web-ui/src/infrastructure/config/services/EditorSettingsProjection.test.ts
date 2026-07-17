import { describe, expect, it } from 'vitest';
import {
  getEditorSettingId,
  mergeEditorSettingsProjection,
  parseEditorSettingsProjection,
} from './EditorSettingsProjection';

const catalogProjection = {
  font_size: 14,
  font_family: 'Consolas, "Courier New", monospace',
  line_height: 1.5,
  tab_size: 2,
  insert_spaces: true,
  word_wrap: 'off',
  line_numbers: 'on',
  minimap: { enabled: true, side: 'right', size: 'proportional' },
  theme: 'vs',
  auto_save: 'afterDelay',
  auto_save_delay: 1000,
  format_on_save: true,
  format_on_paste: true,
  trim_auto_whitespace: true,
};

describe('parseEditorSettingsProjection', () => {
  it('keeps only the fields owned by the persisted Catalog contract', () => {
    expect(parseEditorSettingsProjection({
      ...catalogProjection,
      cursor_style: 'block',
      semantic_highlighting: false,
    })).toEqual(catalogProjection);
  });

  it('fails closed when the Catalog projection is incomplete', () => {
    const { font_size: _fontSize, ...incomplete } = catalogProjection;

    expect(() => parseEditorSettingsProjection(incomplete)).toThrow(
      'Catalog projection is missing editor.font_size',
    );
  });

  it('preserves only exact dirty setting IDs while accepting unrelated commits', () => {
    const draft = {
      ...catalogProjection,
      font_size: 18,
      minimap: { ...catalogProjection.minimap, side: 'left' },
    };
    const committed = {
      ...catalogProjection,
      font_size: 16,
      font_family: 'Fira Code',
      minimap: { ...catalogProjection.minimap, side: 'right', size: 'fill' },
    };

    expect(mergeEditorSettingsProjection(
      draft,
      committed,
      new Set([
        getEditorSettingId('font_size'),
        getEditorSettingId('minimap.side'),
      ]),
    )).toMatchObject({
      font_size: 18,
      font_family: 'Fira Code',
      minimap: { side: 'left', size: 'fill' },
    });
  });
});
