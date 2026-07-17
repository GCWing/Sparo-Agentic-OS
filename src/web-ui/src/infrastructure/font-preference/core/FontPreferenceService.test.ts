// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FontPreference } from '../types';

const configManagerMock = vi.hoisted(() => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  resetSetting: vi.fn(),
  watch: vi.fn(),
}));

const themeOnMock = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/config/services/ConfigManager', () => ({
  configManager: configManagerMock,
}));

vi.mock('@/infrastructure/theme', () => ({
  themeService: { on: themeOnMock },
}));

import { FontPreferenceService } from './FontPreferenceService';

const DEFAULT_ACCEPTED: FontPreference = {
  uiSize: { level: 'default', customPx: null },
  flowChat: { mode: 'sync', basePx: null },
  markdownEditor: { mode: 'sync', basePx: null },
};

function clonePreference(preference: FontPreference): FontPreference {
  return {
    uiSize: { ...preference.uiSize },
    flowChat: { ...preference.flowChat },
    markdownEditor: { ...preference.markdownEditor },
  };
}

function projectPreference(preference: FontPreference) {
  return {
    ui_size: {
      level: preference.uiSize.level,
      custom_px: preference.uiSize.customPx,
    },
    flow_chat: {
      mode: preference.flowChat.mode,
      base_px: preference.flowChat.basePx,
    },
    markdown_editor: {
      mode: preference.markdownEditor.mode,
      base_px: preference.markdownEditor.basePx,
    },
  };
}

describe('FontPreferenceService authoritative projection', () => {
  let accepted: FontPreference;

  beforeEach(() => {
    accepted = clonePreference(DEFAULT_ACCEPTED);
    configManagerMock.getSetting.mockReset();
    configManagerMock.setSetting.mockReset();
    configManagerMock.resetSetting.mockReset();
    configManagerMock.watch.mockReset();
    themeOnMock.mockReset();

    configManagerMock.getSetting.mockImplementation(async () => projectPreference(accepted));
    configManagerMock.setSetting.mockResolvedValue(undefined);
    configManagerMock.resetSetting.mockResolvedValue(undefined);
    configManagerMock.watch.mockReturnValue(vi.fn());

    document.documentElement.removeAttribute('style');
    document.body.removeAttribute('style');
  });

  it('initializes only from a complete accepted font projection', async () => {
    const service = new FontPreferenceService();

    await service.initialize();

    expect(service.getPreference()).toEqual(DEFAULT_ACCEPTED);
    expect(document.documentElement.style.getPropertyValue('--font-size-base')).toBe('14px');
    expect(document.documentElement.style.getPropertyValue('--flowchat-font-size-base')).toBe('14px');
    expect(configManagerMock.watch).toHaveBeenCalledWith('core.font', expect.any(Function));
  });

  it.each([
    {
      ui_size: { level: 'default', custom_px: null },
      flow_chat: { mode: 'lift', base_px: null },
      markdown_editor: { mode: 'sync', base_px: null },
    },
    {
      ui_size: { level: 'custom', custom_px: null },
      flow_chat: { mode: 'sync', base_px: null },
      markdown_editor: { mode: 'sync', base_px: null },
    },
    {
      ui_size: { level: 'default', custom_px: null },
      flow_chat: { mode: 'sync', base_px: null },
    },
  ])('fails closed for an incomplete or legacy projection', async (invalidProjection) => {
    configManagerMock.getSetting.mockResolvedValue(invalidProjection);
    const service = new FontPreferenceService();

    await expect(service.initialize()).rejects.toThrow();

    expect(service.getPreference()).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--font-size-base')).toBe('');
  });

  it('keeps the accepted preference unchanged when persistence fails', async () => {
    const service = new FontPreferenceService();
    await service.initialize();
    configManagerMock.setSetting.mockRejectedValueOnce(new Error('commit failed'));

    await expect(service.setUiSize('large')).rejects.toThrow('commit failed');

    expect(service.getPreference()).toEqual(DEFAULT_ACCEPTED);
    expect(document.documentElement.style.getPropertyValue('--font-size-base')).toBe('14px');
    expect(configManagerMock.getSetting).toHaveBeenCalledTimes(1);
  });

  it('applies the accepted snapshot read after a successful write', async () => {
    const service = new FontPreferenceService();
    await service.initialize();
    configManagerMock.setSetting.mockImplementationOnce(async () => {
      accepted = {
        ...clonePreference(DEFAULT_ACCEPTED),
        uiSize: { level: 'small', customPx: null },
      };
    });

    await service.setUiSize('large');

    expect(configManagerMock.setSetting).toHaveBeenCalledWith(
      'core.font',
      expect.objectContaining({ ui_size: { level: 'large', custom_px: null } }),
    );
    expect(service.getPreference()?.uiSize).toEqual({ level: 'small', customPx: null });
    expect(document.documentElement.style.getPropertyValue('--font-size-base')).toBe('13px');
  });

  it('resets through ConfigManager and reloads the accepted default snapshot', async () => {
    accepted = {
      uiSize: { level: 'custom', customPx: 18 },
      flowChat: { mode: 'independent', basePx: 17 },
      markdownEditor: { mode: 'independent', basePx: 16 },
    };
    const service = new FontPreferenceService();
    await service.initialize();
    configManagerMock.resetSetting.mockImplementationOnce(async () => {
      accepted = clonePreference(DEFAULT_ACCEPTED);
    });

    await service.reset();

    expect(configManagerMock.resetSetting).toHaveBeenCalledWith(
      'core.font',
    );
    expect(service.getPreference()).toEqual(DEFAULT_ACCEPTED);
    expect(document.documentElement.style.getPropertyValue('--font-size-base')).toBe('14px');
  });
});
