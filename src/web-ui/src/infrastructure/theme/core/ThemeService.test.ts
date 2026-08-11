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

vi.mock('@/design-system', () => ({
  applyCssVars: vi.fn(),
  createComponentCssVarMap: vi.fn(() => ({})),
  createLegacyCssVarMap: vi.fn(() => ({})),
  createThemeCssVarMap: vi.fn(() => ({})),
}));

vi.mock('../integrations/MonacoThemeSync', () => ({
  monacoThemeSync: { syncTheme: vi.fn() },
}));

import { applyCssVars, createThemeCssVarMap } from '@/design-system';
import { ThemeService } from './ThemeService';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('ThemeService config synchronization', () => {
  let notifyThemesChanged: (() => void) | undefined;

  beforeEach(() => {
    configManagerMock.getSetting.mockReset();
    configManagerMock.setSetting.mockReset();
    configManagerMock.watch.mockReset();
    notifyThemesChanged = undefined;
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-type');
    window.localStorage.clear();

    configManagerMock.getSetting.mockResolvedValue({ current: 'light', custom: [] });
    configManagerMock.setSetting.mockResolvedValue(undefined);
    configManagerMock.watch.mockImplementation((settingId: string, callback: () => void) => {
      expect(settingId).toBe('core.themes');
      notifyThemesChanged = callback;
      return vi.fn();
    });
  });

  it('hot-reloads the authoritative themes projection through ConfigManager', async () => {
    const service = new ThemeService();
    await service.initialize();

    expect(configManagerMock.watch).toHaveBeenCalledTimes(1);
    expect(service.getCurrentThemeId()).toBe('light');
    expect(service.getThemeList().map((theme) => theme.id)).toEqual(['light', 'dark']);

    configManagerMock.getSetting.mockResolvedValue({ current: 'dark', custom: [] });
    notifyThemesChanged?.();

    await vi.waitFor(() => {
      expect(service.getCurrentThemeId()).toBe('dark');
      expect(document.documentElement.dataset.theme).toBe('dark');
    });
    expect(configManagerMock.setSetting).not.toHaveBeenCalled();
  });

  it('keeps complete bootstrap tokens while authoritative loading fails closed', async () => {
    configManagerMock.getSetting.mockRejectedValueOnce(new Error('snapshot unavailable'));
    const service = new ThemeService();

    await expect(service.initialize()).rejects.toThrow('snapshot unavailable');

    expect(service.getCurrentThemeId()).toBeNull();
    expect(service.getResolvedThemeId()).toBeNull();
    expect(() => service.getCurrentTheme()).toThrow('no authoritative current theme');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(createThemeCssVarMap).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'light' }),
    );
    expect(applyCssVars).toHaveBeenCalled();
  });

  it('rejects legacy theme aliases instead of translating them', async () => {
    configManagerMock.getSetting.mockResolvedValueOnce({ current: 'sparo-dark', custom: [] });
    const service = new ThemeService();

    await expect(service.initialize()).rejects.toThrow('Unknown current theme id: sparo-dark');

    expect(service.getCurrentThemeId()).toBeNull();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('does not apply a requested theme when persistence fails', async () => {
    const service = new ThemeService();
    await service.initialize();
    configManagerMock.setSetting.mockRejectedValueOnce(new Error('commit failed'));

    await expect(service.applyTheme('dark')).rejects.toThrow('commit failed');

    expect(service.getCurrentThemeId()).toBe('light');
    expect(service.getResolvedThemeId()).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(configManagerMock.getSetting).toHaveBeenCalledTimes(1);
  });

  it('applies the accepted snapshot read after a successful write', async () => {
    const service = new ThemeService();
    await service.initialize();
    configManagerMock.setSetting.mockImplementationOnce(async () => {
      configManagerMock.getSetting.mockResolvedValue({ current: 'light', custom: [] });
    });

    await service.applyTheme('dark');

    expect(configManagerMock.setSetting).toHaveBeenCalledWith(
      'core.themes.current',
      'dark',
    );
    expect(service.getCurrentThemeId()).toBe('light');
    expect(service.getResolvedThemeId()).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('discards stale reads and leaves the latest queued theme applied', async () => {
    const service = new ThemeService();
    await service.initialize();

    const staleRead = deferred<{ current: string; custom: [] }>();
    const latestRead = deferred<{ current: string; custom: [] }>();
    configManagerMock.getSetting
      .mockReturnValueOnce(staleRead.promise)
      .mockReturnValueOnce(latestRead.promise);

    notifyThemesChanged?.();
    await vi.waitFor(() => {
      expect(configManagerMock.getSetting).toHaveBeenCalledTimes(2);
    });
    notifyThemesChanged?.();
    staleRead.resolve({ current: 'dark', custom: [] });

    await vi.waitFor(() => {
      expect(configManagerMock.getSetting).toHaveBeenCalledTimes(3);
    });
    latestRead.resolve({ current: 'light', custom: [] });

    await vi.waitFor(() => {
      expect(service.getCurrentThemeId()).toBe('light');
      expect(document.documentElement.dataset.theme).toBe('light');
    });
  });
});
