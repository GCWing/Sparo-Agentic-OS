import type { ITheme } from '@xterm/xterm';
import type { ThemeConfig, ThemeType } from '@/infrastructure/theme/types';

export const DEFAULT_XTERM_MINIMUM_CONTRAST_RATIO = 6;

// ANSI source defaults mirror the xterm/VSC terminal palette. They remain
// literal because xterm needs concrete colors when app CSS variables are absent.
const XTERM_ANSI_SOURCE_DEFAULTS = {
  black: '#000000',
  lightRed: '#cd3131',
  lightGreen: '#107C10',
  lightYellow: '#949800',
  lightBlue: '#0451a5',
  lightMagenta: '#bc05bc',
  lightCyan: '#0598bc',
  lightWhite: '#555555',
  brightBlack: '#666666',
  lightBrightGreen: '#14CE14',
  lightBrightYellow: '#b5ba00',
  lightBrightWhite: '#a5a5a5',
  darkGreen: '#0dbc79',
  darkYellow: '#e5e510',
  darkBlue: '#2472c8',
  darkMagenta: '#bc3fbc',
  darkCyan: '#11a8cd',
  darkWhite: '#e5e5e5',
  darkBrightRed: '#f14c4c',
  darkBrightGreen: '#23d18b',
  darkBrightYellow: '#f5f543',
  darkBrightBlue: '#3b8eea',
  darkBrightMagenta: '#d670d6',
  darkBrightCyan: '#29b8db',
} as const;

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
  black: `var(--ds-terminal-light-black, ${XTERM_ANSI_SOURCE_DEFAULTS.black})`,
  red: `var(--ds-terminal-light-red, ${XTERM_ANSI_SOURCE_DEFAULTS.lightRed})`,
  green: `var(--ds-terminal-light-green, ${XTERM_ANSI_SOURCE_DEFAULTS.lightGreen})`,
  yellow: `var(--ds-terminal-light-yellow, ${XTERM_ANSI_SOURCE_DEFAULTS.lightYellow})`,
  blue: `var(--ds-terminal-light-blue, ${XTERM_ANSI_SOURCE_DEFAULTS.lightBlue})`,
  magenta: `var(--ds-terminal-light-magenta, ${XTERM_ANSI_SOURCE_DEFAULTS.lightMagenta})`,
  cyan: `var(--ds-terminal-light-cyan, ${XTERM_ANSI_SOURCE_DEFAULTS.lightCyan})`,
  white: `var(--ds-terminal-light-white, ${XTERM_ANSI_SOURCE_DEFAULTS.lightWhite})`,
  brightBlack: `var(--ds-terminal-light-bright-black, ${XTERM_ANSI_SOURCE_DEFAULTS.brightBlack})`,
  brightRed: `var(--ds-terminal-light-bright-red, ${XTERM_ANSI_SOURCE_DEFAULTS.lightRed})`,
  brightGreen: `var(--ds-terminal-light-bright-green, ${XTERM_ANSI_SOURCE_DEFAULTS.lightBrightGreen})`,
  brightYellow: `var(--ds-terminal-light-bright-yellow, ${XTERM_ANSI_SOURCE_DEFAULTS.lightBrightYellow})`,
  brightBlue: `var(--ds-terminal-light-bright-blue, ${XTERM_ANSI_SOURCE_DEFAULTS.lightBlue})`,
  brightMagenta: `var(--ds-terminal-light-bright-magenta, ${XTERM_ANSI_SOURCE_DEFAULTS.lightMagenta})`,
  brightCyan: `var(--ds-terminal-light-bright-cyan, ${XTERM_ANSI_SOURCE_DEFAULTS.lightCyan})`,
  brightWhite: `var(--ds-terminal-light-bright-white, ${XTERM_ANSI_SOURCE_DEFAULTS.lightBrightWhite})`,
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
  black: `var(--ds-terminal-dark-black, ${XTERM_ANSI_SOURCE_DEFAULTS.black})`,
  red: `var(--ds-terminal-dark-red, ${XTERM_ANSI_SOURCE_DEFAULTS.lightRed})`,
  green: `var(--ds-terminal-dark-green, ${XTERM_ANSI_SOURCE_DEFAULTS.darkGreen})`,
  yellow: `var(--ds-terminal-dark-yellow, ${XTERM_ANSI_SOURCE_DEFAULTS.darkYellow})`,
  blue: `var(--ds-terminal-dark-blue, ${XTERM_ANSI_SOURCE_DEFAULTS.darkBlue})`,
  magenta: `var(--ds-terminal-dark-magenta, ${XTERM_ANSI_SOURCE_DEFAULTS.darkMagenta})`,
  cyan: `var(--ds-terminal-dark-cyan, ${XTERM_ANSI_SOURCE_DEFAULTS.darkCyan})`,
  white: `var(--ds-terminal-dark-white, ${XTERM_ANSI_SOURCE_DEFAULTS.darkWhite})`,
  brightBlack: `var(--ds-terminal-dark-bright-black, ${XTERM_ANSI_SOURCE_DEFAULTS.brightBlack})`,
  brightRed: `var(--ds-terminal-dark-bright-red, ${XTERM_ANSI_SOURCE_DEFAULTS.darkBrightRed})`,
  brightGreen: `var(--ds-terminal-dark-bright-green, ${XTERM_ANSI_SOURCE_DEFAULTS.darkBrightGreen})`,
  brightYellow: `var(--ds-terminal-dark-bright-yellow, ${XTERM_ANSI_SOURCE_DEFAULTS.darkBrightYellow})`,
  brightBlue: `var(--ds-terminal-dark-bright-blue, ${XTERM_ANSI_SOURCE_DEFAULTS.darkBrightBlue})`,
  brightMagenta: `var(--ds-terminal-dark-bright-magenta, ${XTERM_ANSI_SOURCE_DEFAULTS.darkBrightMagenta})`,
  brightCyan: `var(--ds-terminal-dark-bright-cyan, ${XTERM_ANSI_SOURCE_DEFAULTS.darkBrightCyan})`,
  brightWhite: `var(--ds-terminal-dark-bright-white, ${XTERM_ANSI_SOURCE_DEFAULTS.darkWhite})`,
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
