/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowToolItem, ToolCardConfig } from '../types/flow-chat';
import { SettingsCatalogCard } from './SettingsCatalogCard';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const translate = (key: string, options?: Record<string, unknown>) => {
  if (typeof options?.defaultValue === 'string') return options.defaultValue;
  const labels: Record<string, string> = {
    'toolCards.common.expand': '展开',
    'toolCards.common.collapse': '收起',
    'toolCards.settingsCatalog.actions.query': '查找设置',
    'toolCards.settingsCatalog.actions.get': '读取设置',
    'toolCards.settingsCatalog.actions.unknown': '检查设置',
    'toolCards.settingsCatalog.results.listLabel': '找到的设置',
    'toolCards.settingsCatalog.results.currentValue': '当前值',
    'toolCards.settingsCatalog.results.notSet': '未设置',
    'toolCards.settingsCatalog.results.enabled': '已开启',
    'toolCards.settingsCatalog.results.disabled': '已关闭',
  };
  if (key === 'toolCards.settingsCatalog.status.matched') {
    return `找到 ${options?.count ?? 0} 项与请求相关的设置`;
  }
  if (key === 'toolCards.settingsCatalog.summaryLine') {
    return `${options?.action ?? ''}：${options?.summary ?? ''}`;
  }
  if (key === 'toolCards.settingsCatalog.results.itemCount') {
    return `${options?.count ?? 0} 项`;
  }
  return labels[key] ?? key;
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translate,
    i18n: { language: 'zh-CN', t: translate },
  }),
}));

const config: ToolCardConfig = {
  toolName: 'SettingsCatalog',
  displayName: 'Settings catalog',
  icon: '',
  requiresConfirmation: false,
  resultDisplayType: 'summary',
};

function tool(overrides: Partial<FlowToolItem> = {}): FlowToolItem {
  return {
    id: 'settings-catalog-1',
    type: 'tool',
    toolName: 'SettingsCatalog',
    toolCall: {
      id: 'settings-catalog-1',
      input: { action: 'query', query: 'font' },
    },
    timestamp: Date.UTC(2026, 6, 16, 2, 24),
    status: 'completed',
    runtime: {
      lifecycle: 'completed',
      inputPhase: 'parsed',
      confirmation: 'none',
      input: { action: 'query', query: 'font' },
    },
    toolResult: {
      success: true,
      result: {
        revision: 12,
        catalogVersion: 'sha256:private-version',
        settings: [
          {
            descriptor: {
              id: 'core.ui.interface_scale',
              presentation: {
                titleKey: 'settings/appearance:appearance.fontSize.uiSizeLabel',
                tabId: 'appearance',
              },
              resolvedOptions: [{ value: 'compact', label: '紧凑' }],
            },
            current: { kind: 'value', value: 'compact' },
          },
          {
            descriptor: {
              id: 'core.editor.font_size',
              presentation: {
                titleKey: 'settings/appearance:appearance.fontSize.markdownEditorLabel',
                tabId: 'appearance',
              },
            },
            current: { kind: 'value', value: 14 },
          },
        ],
      },
    },
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('SettingsCatalogCard', () => {
  it('uses the system compact card and explains the user-facing action', () => {
    const html = renderToStaticMarkup(
      <SettingsCatalogCard config={config} toolItem={tool()} />,
    );

    expect(html).toContain('compact-tool-card');
    expect(html).toContain('compact-card-status-icon--expandable');
    expect(html).not.toContain('tool-card-icon-slot');
    expect(html).toContain('查找设置');
    expect(html).toContain('找到 2 项与请求相关的设置');
    expect(html).not.toContain('设置目录');
    expect(html).not.toContain('sha256:private-version');
    expect(html).not.toContain('core.ui.interface_scale');
    expect(html).not.toContain('interface scale');
  });

  it('expands to show the found setting list with location and current values', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    act(() => {
      root.render(<SettingsCatalogCard config={config} toolItem={tool()} />);
    });

    expect(host.querySelector('[aria-label="找到的设置"]')).toBeNull();
    const expandButton = host.querySelector<HTMLButtonElement>('[aria-label="展开"]');
    expect(expandButton?.getAttribute('aria-expanded')).toBe('false');

    act(() => expandButton?.click());

    expect(host.querySelector('[aria-label="找到的设置"]')).not.toBeNull();
    expect(host.textContent).toContain('interface scale');
    expect(host.textContent).toContain('font size');
    expect(host.textContent).toContain('appearance');
    expect(host.textContent).toContain('当前值');
    expect(host.textContent).toContain('紧凑');
    expect(host.textContent).toContain('14');
    expect(host.textContent).not.toContain('core.editor.font_size');
    expect(host.textContent).not.toContain('sha256:private-version');

    act(() => root.unmount());
    host.remove();
  });
});
