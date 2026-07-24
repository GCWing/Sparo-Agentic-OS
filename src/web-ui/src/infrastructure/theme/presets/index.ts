export { darkTheme } from './dark-theme';
export { lightTheme } from './light-theme';

import { darkTheme } from './dark-theme';
import { lightTheme } from './light-theme';
import { ThemeConfig, ThemeId } from '../types';

/** Default light / dark builtin themes used when following system appearance. */
export const DEFAULT_LIGHT_THEME_ID: ThemeId = 'light';
export const DEFAULT_DARK_THEME_ID: ThemeId = 'dark';

/**
 * Picks dark vs light from `prefers-color-scheme`.
 * Used when the user has no saved theme preference.
 */
export function getSystemPreferredDefaultThemeId(): ThemeId {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return DEFAULT_LIGHT_THEME_ID;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? DEFAULT_DARK_THEME_ID
    : DEFAULT_LIGHT_THEME_ID;
}

/** Static fallback when system preference is unavailable (e.g. SSR). */
export const DEFAULT_THEME_ID: ThemeId = DEFAULT_LIGHT_THEME_ID;

export const builtinThemes: ThemeConfig[] = [
  lightTheme,
  darkTheme,
];
