import type { ITheme } from '@xterm/xterm';
import type { ThemeConfig, ThemeType } from '@/infrastructure/theme/types';

export const DEFAULT_XTERM_MINIMUM_CONTRAST_RATIO = 6;


const LIGHT_ANSI: Required<Pick<ITheme,
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'brightBlack'
  | 'brightRed'
  | 'brightGreen'
  | 'brightYellow'
  | 'brightBlue'
  | 'brightMagenta'
  | 'brightCyan'
  | 'brightWhite'
>> = {
  black: 'var(--ds-terminal-light-black, #000000)',
  red: 'var(--ds-terminal-light-red, #cd3131)',
  green: 'var(--ds-terminal-light-green, #107C10)',
  yellow: 'var(--ds-terminal-light-yellow, #949800)',
  blue: 'var(--ds-terminal-light-blue, #0451a5)',
  magenta: 'var(--ds-terminal-light-magenta, #bc05bc)',
  cyan: 'var(--ds-terminal-light-cyan, #0598bc)',
  white: 'var(--ds-terminal-light-white, #555555)',
  brightBlack: 'var(--ds-terminal-light-bright-black, #666666)',
  brightRed: 'var(--ds-terminal-light-bright-red, #cd3131)',
  brightGreen: 'var(--ds-terminal-light-bright-green, #14CE14)',
  brightYellow: 'var(--ds-terminal-light-bright-yellow, #b5ba00)',
  brightBlue: 'var(--ds-terminal-light-bright-blue, #0451a5)',
  brightMagenta: 'var(--ds-terminal-light-bright-magenta, #bc05bc)',
  brightCyan: 'var(--ds-terminal-light-bright-cyan, #0598bc)',
  brightWhite: 'var(--ds-terminal-light-bright-white, #a5a5a5)',
};

const DARK_ANSI: Required<Pick<ITheme,
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'brightBlack'
  | 'brightRed'
  | 'brightGreen'
  | 'brightYellow'
  | 'brightBlue'
  | 'brightMagenta'
  | 'brightCyan'
  | 'brightWhite'
>> = {
  black: 'var(--ds-terminal-dark-black, #000000)',
  red: 'var(--ds-terminal-dark-red, #cd3131)',
  green: 'var(--ds-terminal-dark-green, #0dbc79)',
  yellow: 'var(--ds-terminal-dark-yellow, #e5e510)',
  blue: 'var(--ds-terminal-dark-blue, #2472c8)',
  magenta: 'var(--ds-terminal-dark-magenta, #bc3fbc)',
  cyan: 'var(--ds-terminal-dark-cyan, #11a8cd)',
  white: 'var(--ds-terminal-dark-white, #e5e5e5)',
  brightBlack: 'var(--ds-terminal-dark-bright-black, #666666)',
  brightRed: 'var(--ds-terminal-dark-bright-red, #f14c4c)',
  brightGreen: 'var(--ds-terminal-dark-bright-green, #23d18b)',
  brightYellow: 'var(--ds-terminal-dark-bright-yellow, #f5f543)',
  brightBlue: 'var(--ds-terminal-dark-bright-blue, #3b8eea)',
  brightMagenta: 'var(--ds-terminal-dark-bright-magenta, #d670d6)',
  brightCyan: 'var(--ds-terminal-dark-bright-cyan, #29b8db)',
  brightWhite: 'var(--ds-terminal-dark-bright-white, #e5e5e5)',
};

export function getXtermAnsiPalette(themeType: ThemeType): Required<Pick<ITheme,
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'brightBlack'
  | 'brightRed'
  | 'brightGreen'
  | 'brightYellow'
  | 'brightBlue'
  | 'brightMagenta'
  | 'brightCyan'
  | 'brightWhite'
>> {
  return themeType === 'dark' ? DARK_ANSI : LIGHT_ANSI;
}

export function getXtermFontWeights(themeType: ThemeType): {
  fontWeight: 'normal' | '500';
  fontWeightBold: 'bold' | '700';
} {
  return themeType === 'dark'
    ? { fontWeight: 'normal', fontWeightBold: 'bold' }
    : { fontWeight: '500', fontWeightBold: '700' };
}

export function buildXtermTheme(
  theme: ThemeConfig,
  overrides: Partial<ITheme> = {},
): ITheme {
  return {
    background: theme.colors.background.scene,
    foreground: theme.colors.text.primary,
    cursor: theme.colors.text.primary,
    cursorAccent: theme.colors.background.secondary,
    selectionBackground: theme.colors.semantic.highlightBg,
    selectionInactiveBackground: theme.colors.element.medium,
    black: theme.colors.background.primary,
    red: theme.colors.semantic.error,
    green: theme.colors.semantic.success,
    yellow: theme.colors.semantic.warning,
    blue: theme.colors.accent[600],
    magenta: theme.colors.purple?.[500] ?? theme.colors.accent[700],
    cyan: theme.colors.semantic.info,
    white: theme.colors.text.secondary,
    brightBlack: theme.colors.text.muted,
    brightRed: theme.colors.semantic.error,
    brightGreen: theme.colors.semantic.success,
    brightYellow: theme.colors.semantic.warning,
    brightBlue: theme.colors.accent[500],
    brightMagenta: theme.colors.purple?.[400] ?? theme.colors.accent[500],
    brightCyan: theme.colors.semantic.info,
    brightWhite: theme.colors.text.primary,
    ...overrides,
  };
}
