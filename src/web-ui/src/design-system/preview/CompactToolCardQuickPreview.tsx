import React, { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import { i18nService } from '@/infrastructure/i18n';
import { lightTheme } from '@/infrastructure/theme/presets';
import {
  applyCssVars,
  createComponentCssVarMap,
  createLegacyCssVarMap,
  createThemeCssVarMap,
  type ThemeConfig,
} from '@/design-system/foundation/tokens';
import { AppDefinedToolCard } from '@/flow_chat/tool-cards/AppDefinedToolCard';
import { LSDisplay } from '@/flow_chat/tool-cards/LSDisplay';
import { SettingsCatalogCard } from '@/flow_chat/tool-cards/SettingsCatalogCard';
import './CompactToolCardQuickPreview.scss';

const lsEntries = Array.from({ length: 10 }, (_, index) => ({
  name: `setting-${index + 1}.json`,
  path: `D:/workspace/settings/setting-${index + 1}.json`,
  is_dir: false,
  modified_time: '2026-07-16T10:24:00Z',
}));

const lsToolItem = {
  id: 'qa-ls',
  type: 'tool',
  toolName: 'LS',
  status: 'completed',
  timestamp: Date.now(),
  runtime: {
    lifecycle: 'completed',
    inputPhase: 'parsed',
    confirmation: 'none',
    input: { path: 'D:/workspace/settings' },
  },
  toolCall: { id: 'qa-ls', input: { path: 'D:/workspace/settings' } },
  toolResult: { success: true, result: { entries: lsEntries } },
};

const catalogSettings = [
  ['core.font.ui_size.level', 'settings/appearance:appearance.fontSize.uiSizeLabel', 'appearance', 'medium'],
  ['core.font.ui_size.custom_px', 'settings/appearance:appearance.fontSize.customPxLabel', 'appearance', null],
  ['core.font.flow_chat.mode', 'settings/appearance:appearance.fontSize.flowChatLabel', 'appearance', 'sync'],
  ['core.font.flow_chat.base_px', 'settings/appearance:appearance.fontSize.flowChatLabel', 'appearance', 15],
  ['core.font.markdown_editor.mode', 'settings/appearance:appearance.fontSize.markdownEditorLabel', 'appearance', 'custom'],
  ['core.font.markdown_editor.base_px', 'settings/appearance:appearance.fontSize.markdownEditorLabel', 'appearance', 16],
  ['core.editor.font_size', 'settings/editor:appearance.fontSize', 'editor', 14],
  ['core.editor.font_family', 'settings/editor:appearance.font', 'editor', 'JetBrains Mono'],
  ['core.editor.line_height', 'settings/editor:appearance.lineHeight', 'editor', 1.6],
  ['core.editor.minimap.enabled', 'settings/editor:display.minimap', 'editor', true],
].map(([id, titleKey, tabId, value]) => ({
  descriptor: { id, presentation: { titleKey, tabId } },
  current: { kind: 'value', value },
}));

const catalogToolItem = {
  id: 'qa-catalog',
  type: 'tool',
  toolName: 'LS',
  status: 'completed',
  timestamp: Date.now(),
  runtime: {
    lifecycle: 'completed',
    inputPhase: 'parsed',
    confirmation: 'none',
    input: { action: 'query', query: '字体' },
  },
  toolCall: { id: 'qa-catalog', input: { action: 'query', query: '字体' } },
  toolResult: {
    success: true,
    result: {
      revision: 7,
      catalogVersion: 'qa-private-version',
      settings: catalogSettings,
    },
  },
};

const tableConfig = {
  toolName: 'agentcomponent__excel-live-agent__read_table',
  displayName: '读取表格',
  icon: 'Table',
  requiresConfirmation: false,
  resultDisplayType: 'detailed',
  displayMode: 'compact',
  extensionCard: {
    kind: 'appDefined',
    family: 'excel-live',
    template: 'compact',
    title: '读取表格',
    icon: 'Table',
    summary: {
      preparing: '正在准备读取…',
      running: '正在读取工作表数据…',
      completed: '已读取 12 行数据',
      failed: '读取表格失败',
    },
    fields: [],
  },
};

const tableToolItem = {
  id: 'qa-table',
  type: 'tool',
  toolName: 'agentcomponent__excel-live-agent__read_table',
  status: 'completed',
  timestamp: Date.now(),
  runtime: {
    lifecycle: 'completed',
    inputPhase: 'parsed',
    confirmation: 'none',
    input: { sheet: 'Sheet1', range: 'A1:D12' },
  },
  toolCall: { id: 'qa-table', input: { sheet: 'Sheet1', range: 'A1:D12' } },
  toolResult: {
    success: true,
    result: {
      bridge: {
        status: 'completed',
        output: { summary: '已读取 12 行数据', rows: 12, range: 'A1:D12' },
      },
    },
  },
};

const compactConfig = {
  toolName: 'LS',
  displayName: 'LS',
  icon: '',
  requiresConfirmation: false,
  resultDisplayType: 'summary',
};

export const CompactToolCardQuickPreview: React.FC = () => {
  const selectedSample = new URLSearchParams(window.location.search).get('sample');

  useEffect(() => {
    const root = document.documentElement;
    const theme = lightTheme as unknown as ThemeConfig;
    applyCssVars(root, createThemeCssVarMap(theme));
    applyCssVars(root, createLegacyCssVarMap(theme));
    applyCssVars(root, createComponentCssVarMap(theme));
    root.dataset.theme = lightTheme.id;
    root.dataset.themeType = 'light';
  }, []);

  return (
    <I18nextProvider i18n={i18nService.getI18nInstance()}>
      <main className="compact-tool-card-quick-preview">
        {(!selectedSample || selectedSample === 'ls') && (
          <div className="compact-tool-card-quick-preview__sample" data-qa="ls">
            <LSDisplay config={compactConfig as never} toolItem={lsToolItem as never} />
          </div>
        )}
        {(!selectedSample || selectedSample === 'settings') && (
          <div className="compact-tool-card-quick-preview__sample" data-qa="settings">
            <SettingsCatalogCard config={compactConfig as never} toolItem={catalogToolItem as never} />
          </div>
        )}
        {(!selectedSample || selectedSample === 'table') && (
          <div className="compact-tool-card-quick-preview__sample" data-qa="table">
            <AppDefinedToolCard config={tableConfig as never} toolItem={tableToolItem as never} />
          </div>
        )}
      </main>
    </I18nextProvider>
  );
};
