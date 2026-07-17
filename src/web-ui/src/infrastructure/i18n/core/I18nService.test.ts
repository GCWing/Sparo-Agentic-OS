// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const configManagerMock = vi.hoisted(() => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  watch: vi.fn(),
}));

vi.mock('@/infrastructure/config/services/ConfigManager', () => ({
  configManager: configManagerMock,
}));

import { I18nService } from './I18nService';

describe('I18nService config synchronization', () => {
  let notifyLanguageChanged: (() => void) | undefined;

  beforeEach(() => {
    configManagerMock.getSetting.mockReset();
    configManagerMock.setSetting.mockReset();
    configManagerMock.watch.mockReset();
    notifyLanguageChanged = undefined;
    document.documentElement.setAttribute('lang', 'en-US');
    document.documentElement.setAttribute('dir', 'ltr');

    configManagerMock.getSetting.mockResolvedValue('en-US');
    configManagerMock.watch.mockImplementation((path: string, callback: () => void) => {
      expect(path).toBe('core.app.language');
      notifyLanguageChanged = callback;
      return vi.fn();
    });
  });

  it('reads and hot-reloads app.language through ConfigManager', async () => {
    const service = new I18nService();

    await service.initialize();

    expect(configManagerMock.watch).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(configManagerMock.getSetting).toHaveBeenCalledWith('core.app.language');
    });

    configManagerMock.getSetting.mockResolvedValue('zh-CN');
    notifyLanguageChanged?.();

    await vi.waitFor(() => {
      expect(service.getCurrentLocale()).toBe('zh-CN');
      expect(document.documentElement.lang).toBe('zh-CN');
    });
    expect(configManagerMock.setSetting).not.toHaveBeenCalled();
  });
});
