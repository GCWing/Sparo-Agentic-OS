/**
 * @vitest-environment jsdom
 */

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowToolItem } from '../types/flow-chat';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const toolApiMocks = vi.hoisted(() => ({
  getAllToolsInfo: vi.fn(),
  getToolInfo: vi.fn(),
}));

vi.mock('@/infrastructure/api/service-api/ToolAPI', () => ({
  toolAPI: toolApiMocks,
}));

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/design-system', () => ({
  Button: ({ children, className, disabled, onClick, title, type = 'button' }: any) => React.createElement(
    'button',
    { className, disabled, onClick, title, type },
    children,
  ),
  CubeLoading: () => React.createElement('span', { 'data-testid': 'cube-loading' }),
  IconButton: ({ children, className, disabled, onClick, ...rest }: any) => React.createElement(
    'button',
    {
      'aria-label': rest['aria-label'],
      'aria-controls': rest['aria-controls'],
      'aria-expanded': rest['aria-expanded'],
      className,
      disabled,
      onClick,
      type: 'button',
    },
    children,
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import { FlowToolCard } from '../components/FlowToolCard';
import { AppDefinedToolCard } from './AppDefinedToolCard';
import {
  getToolCardConfig,
  getToolUiRegistryEntry,
  hasToolCardConfig,
  subscribeToolCardRegistry,
  unregisterToolCardConfig,
  unregisterToolUiRenderer,
} from './index';
import {
  ensureToolCardRegistryEntry,
  syncToolCardRegistryFromBackendManifest,
  watchToolCardRegistryEntry,
} from './ToolManifestSync';

function appDefinedToolInfo(name: string) {
  return {
    name,
    description: 'Reads spreadsheet state',
    is_readonly: true,
    needs_permissions: false,
    ui: {
      card: {
        kind: 'appDefined',
        family: 'excel-live',
        template: 'compact',
        displayName: 'Workbook Meta',
        icon: 'Info',
        summary: {
          running: 'Reading workbook meta',
          completed: 'Workbook meta loaded',
        },
      },
    },
  };
}

describe('ToolManifestSync', () => {
  const registeredNames = new Set<string>();

  beforeEach(() => {
    toolApiMocks.getAllToolsInfo.mockReset();
    toolApiMocks.getToolInfo.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const name of registeredNames) {
      unregisterToolUiRenderer(name);
      unregisterToolCardConfig(name);
    }
    registeredNames.clear();
  });

  it('loads a late Product App tool by exact name and publishes one atomic registry update', async () => {
    const name = 'agentcomponent__excel-live-agent__test_workbook_meta';
    registeredNames.add(name);
    toolApiMocks.getToolInfo.mockResolvedValue(appDefinedToolInfo(name));
    const listener = vi.fn();
    const unsubscribe = subscribeToolCardRegistry(listener);

    expect(hasToolCardConfig(name)).toBe(false);

    await expect(ensureToolCardRegistryEntry(name)).resolves.toBe(true);

    expect(toolApiMocks.getToolInfo).toHaveBeenCalledWith(name);
    expect(getToolCardConfig(name).displayName).toBe('Workbook Meta');
    expect(getToolUiRegistryEntry(name)).toMatchObject({
      component: AppDefinedToolCard,
      template: 'compact',
      family: 'excel-live',
    });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('upgrades an already-mounted fallback card when exact metadata arrives', async () => {
    const name = 'agentcomponent__excel-live-agent__test_reactive_upgrade';
    registeredNames.add(name);
    let resolveInfo: ((value: ReturnType<typeof appDefinedToolInfo>) => void) | undefined;
    toolApiMocks.getToolInfo.mockReturnValue(new Promise(resolve => {
      resolveInfo = resolve;
    }));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const toolItem: FlowToolItem = {
      id: 'late-tool',
      type: 'tool',
      toolName: name,
      toolCall: { id: 'late-tool', input: { workbookId: 'book-1' } },
      timestamp: 1,
      status: 'preparing',
      runtime: {
        lifecycle: 'preparing',
        inputPhase: 'parsed',
        confirmation: 'none',
        input: { workbookId: 'book-1' },
      },
    };

    act(() => root.render(React.createElement(FlowToolCard, { toolItem })));

    expect(host.textContent).toContain(`Tool: ${name}`);
    expect(toolApiMocks.getToolInfo).toHaveBeenCalledWith(name);

    await act(async () => {
      resolveInfo?.(appDefinedToolInfo(name));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Workbook Meta:');
    expect(host.textContent).not.toContain(`Tool: ${name}`);

    act(() => root.unmount());
    host.remove();
  });

  it('deduplicates concurrent exact-manifest requests', async () => {
    const name = 'agentcomponent__excel-live-agent__test_read_range';
    registeredNames.add(name);
    let resolveInfo: ((value: ReturnType<typeof appDefinedToolInfo>) => void) | undefined;
    toolApiMocks.getToolInfo.mockReturnValue(new Promise(resolve => {
      resolveInfo = resolve;
    }));

    const first = ensureToolCardRegistryEntry(name);
    const second = ensureToolCardRegistryEntry(name);

    expect(toolApiMocks.getToolInfo).toHaveBeenCalledTimes(1);
    resolveInfo?.(appDefinedToolInfo(name));

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  });

  it('retries a late-bound manifest automatically after a transient failure', async () => {
    const name = 'agentcomponent__excel-live-agent__test_retry';
    registeredNames.add(name);
    toolApiMocks.getToolInfo
      .mockRejectedValueOnce(new Error('runtime not ready'))
      .mockResolvedValueOnce(appDefinedToolInfo(name));

    await expect(ensureToolCardRegistryEntry(name)).resolves.toBe(true);

    expect(toolApiMocks.getToolInfo).toHaveBeenCalledTimes(2);
  });

  it('keeps low-frequency probing a mounted fallback beyond the activation window', async () => {
    vi.useFakeTimers();
    const name = 'agentcomponent__excel-live-agent__test_slow_activation';
    registeredNames.add(name);
    toolApiMocks.getToolInfo.mockResolvedValue(null);

    const stopWatching = watchToolCardRegistryEntry(name);
    await vi.advanceTimersByTimeAsync(180_000);

    expect(toolApiMocks.getToolInfo.mock.calls.length).toBeGreaterThan(3);
    expect(toolApiMocks.getToolInfo.mock.calls.length).toBeLessThanOrEqual(9);
    expect(hasToolCardConfig(name)).toBe(false);

    toolApiMocks.getToolInfo.mockResolvedValue(appDefinedToolInfo(name));
    await vi.advanceTimersByTimeAsync(61_000);

    expect(hasToolCardConfig(name)).toBe(true);
    stopWatching();
  });

  it('does not let an older full snapshot delete a newer exact registration', async () => {
    const name = 'agentcomponent__excel-live-agent__test_snapshot_race';
    registeredNames.add(name);
    let resolveSnapshot: ((value: unknown[]) => void) | undefined;
    toolApiMocks.getAllToolsInfo.mockReturnValue(new Promise(resolve => {
      resolveSnapshot = resolve;
    }));
    toolApiMocks.getToolInfo.mockResolvedValue(appDefinedToolInfo(name));

    const fullSync = syncToolCardRegistryFromBackendManifest();
    await expect(ensureToolCardRegistryEntry(name)).resolves.toBe(true);
    expect(hasToolCardConfig(name)).toBe(true);

    resolveSnapshot?.([]);
    await fullSync;

    expect(hasToolCardConfig(name)).toBe(true);
    expect(getToolUiRegistryEntry(name).component).toBe(AppDefinedToolCard);
  });

  it('does not permanently cache the startup manifest snapshot', async () => {
    const name = 'agentcomponent__excel-live-agent__test_late_sync';
    registeredNames.add(name);
    toolApiMocks.getAllToolsInfo
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([appDefinedToolInfo(name)]);

    await syncToolCardRegistryFromBackendManifest();
    expect(hasToolCardConfig(name)).toBe(false);

    await syncToolCardRegistryFromBackendManifest();
    expect(hasToolCardConfig(name)).toBe(true);
    expect(toolApiMocks.getAllToolsInfo).toHaveBeenCalledTimes(2);
  });

  it('lets a newer authoritative snapshot remove an unloaded exact tool', async () => {
    const name = 'agentcomponent__excel-live-agent__test_authoritative_cleanup';
    registeredNames.add(name);
    toolApiMocks.getToolInfo.mockResolvedValue(appDefinedToolInfo(name));
    toolApiMocks.getAllToolsInfo.mockResolvedValue([]);

    await expect(ensureToolCardRegistryEntry(name)).resolves.toBe(true);
    expect(hasToolCardConfig(name)).toBe(true);

    await syncToolCardRegistryFromBackendManifest();

    expect(hasToolCardConfig(name)).toBe(false);
    expect(getToolUiRegistryEntry(name).component).not.toBe(AppDefinedToolCard);
  });
});
