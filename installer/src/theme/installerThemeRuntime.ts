import { useLayoutEffect } from 'react';
import { SYSTEM_THEME_ID, type ThemeId, type ThemePreferenceId } from '../types/installer';
import type { InstallerTheme } from './installerThemesData';
import { findInstallerThemeById } from './installerThemesData';

/** Same as main app `getSystemPreferredDefaultThemeId` (dark vs light from OS). */
export function getSystemPreferredBuiltinThemeId(): ThemeId {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Resolved built-in theme for UI sync (preview, chrome, logos). Not reactive to OS changes unless preference is `system` and caller re-runs. */
export function resolveInstallerThemeForPreference(preference: ThemePreferenceId): InstallerTheme {
  if (preference === SYSTEM_THEME_ID) {
    return findInstallerThemeById(getSystemPreferredBuiltinThemeId());
  }
  return findInstallerThemeById(preference as ThemeId);
}

export function applyInstallerThemeToDocument(theme: InstallerTheme): void {
  const root = document.documentElement;
  const { colors } = theme;

  root.style.setProperty('--color-bg-primary', colors.background.primary);
  root.style.setProperty('--color-bg-secondary', colors.background.secondary);
  root.style.setProperty('--color-bg-tertiary', colors.background.tertiary);
  root.style.setProperty('--color-bg-quaternary', colors.background.quaternary);
  root.style.setProperty('--color-bg-elevated', colors.background.elevated);
  root.style.setProperty('--color-bg-workbench', colors.background.workbench);
  root.style.setProperty('--color-bg-flowchat', colors.background.flowchat);
  root.style.setProperty('--color-bg-tooltip', colors.background.tooltip ?? colors.background.elevated);
  root.style.setProperty('--color-text-primary', colors.text.primary);
  root.style.setProperty('--color-text-secondary', colors.text.secondary);
  root.style.setProperty('--color-text-muted', colors.text.muted);
  root.style.setProperty('--color-text-disabled', colors.text.disabled);
  root.style.setProperty('--element-bg-subtle', colors.element.subtle);
  root.style.setProperty('--element-bg-soft', colors.element.soft);
  root.style.setProperty('--element-bg-base', colors.element.base);
  root.style.setProperty('--element-bg-medium', colors.element.medium);
  root.style.setProperty('--element-bg-strong', colors.element.strong);
  root.style.setProperty('--element-bg-elevated', colors.element.elevated);
  root.style.setProperty('--border-subtle', colors.border.subtle);
  root.style.setProperty('--border-base', colors.border.base);
  root.style.setProperty('--border-medium', colors.border.medium);
  root.style.setProperty('--border-strong', colors.border.strong);
  root.style.setProperty('--border-prominent', colors.border.prominent);

  root.style.setProperty('--ink', colors.text.primary);
  root.style.setProperty('--graphite', colors.text.secondary);
  root.style.setProperty('--slate', colors.text.muted);

  root.style.setProperty('--cloud', colors.background.primary);
  root.style.setProperty('--surface', colors.background.secondary);

  root.style.setProperty('--border', colors.border.base);
  root.style.setProperty('--hairline-soft', colors.border.subtle);

  root.style.setProperty('--print', colors.accent['500']);
  root.style.setProperty('--echo', colors.semantic.error);

  if (theme.type === 'dark') {
    root.style.setProperty('--ignite-bg', '#F1F5F9');
    root.style.setProperty('--ignite-fg', '#0F172A');
    root.style.setProperty('--ignite-hover-bg', '#E2E8F0');
    root.style.setProperty('--ignite-hover-border', '#0F172A');
  } else {
    root.style.setProperty('--ignite-bg', colors.text.primary);
    root.style.setProperty('--ignite-fg', '#ffffff');
    root.style.setProperty('--ignite-hover-bg', colors.text.secondary);
    root.style.setProperty('--ignite-hover-border', colors.text.secondary);
  }

  root.style.setProperty('--color-success', colors.semantic.success);
  root.style.setProperty('--color-warning', colors.semantic.warning);
  root.style.setProperty('--color-error', colors.semantic.error);
  root.style.setProperty('--color-info', colors.semantic.info);
  root.style.setProperty('--color-highlight', colors.semantic.highlight);
  root.style.setProperty('--color-highlight-bg', colors.semantic.highlightBg);

  Object.entries(colors.accent).forEach(([key, value]) => {
    root.style.setProperty(`--color-accent-${key}`, value);
  });

  if (colors.purple) {
    Object.entries(colors.purple).forEach(([key, value]) => {
      root.style.setProperty(`--color-purple-${key}`, value);
    });
  }

  root.setAttribute('data-theme', theme.id);
  root.setAttribute('data-theme-type', theme.type);
}

/**
 * Keeps the installer shell CSS variables aligned with the user's theme preference.
 * When preference is `system`, follows `prefers-color-scheme` like the main app ThemeService.
 */
export function useSyncInstallerRootTheme(preference: ThemePreferenceId): void {
  useLayoutEffect(() => {
    if (preference !== SYSTEM_THEME_ID) {
      applyInstallerThemeToDocument(resolveInstallerThemeForPreference(preference));
      return;
    }

    const applyResolved = () => {
      applyInstallerThemeToDocument(resolveInstallerThemeForPreference(SYSTEM_THEME_ID));
    };

    applyResolved();

    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      applyResolved();
    };

    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [preference]);
}
