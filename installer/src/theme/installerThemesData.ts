import type { ThemeId } from '../types/installer';

export type InstallerTheme = {
  id: ThemeId;
  name: string;
  type: 'dark' | 'light';
  colors: {
    background: {
      primary: string;
      secondary: string;
      tertiary: string;
      quaternary: string;
      elevated: string;
      workbench: string;
      flowchat: string;
      tooltip: string;
    };
    text: {
      primary: string;
      secondary: string;
      muted: string;
      disabled: string;
    };
    accent: Record<'50' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800', string>;
    purple: Record<'50' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800', string>;
    semantic: {
      success: string;
      warning: string;
      error: string;
      info: string;
      highlight: string;
      highlightBg: string;
    };
    border: {
      subtle: string;
      base: string;
      medium: string;
      strong: string;
      prominent: string;
    };
    element: {
      subtle: string;
      soft: string;
      base: string;
      medium: string;
      strong: string;
      elevated: string;
    };
  };
};

export const THEMES: InstallerTheme[] = [
  {
    id: 'dark',
    name: 'Dark',
    type: 'dark',
    colors: {
      background: { primary: '#121214', secondary: '#18181a', tertiary: '#121214', quaternary: '#202024', elevated: '#18181a', workbench: '#121214', flowchat: '#121214', tooltip: 'rgba(30, 30, 32, 0.92)' },
      text: { primary: '#e8e8e8', secondary: '#b0b0b0', muted: '#858585', disabled: '#555555' },
      accent: { '50': 'rgba(183, 55, 47, 0.05)', '100': 'rgba(183, 55, 47, 0.09)', '200': 'rgba(183, 55, 47, 0.14)', '300': 'rgba(183, 55, 47, 0.24)', '400': 'rgba(183, 55, 47, 0.42)', '500': '#B7372F', '600': '#9E2F29', '700': 'rgba(158, 47, 41, 0.88)', '800': 'rgba(128, 36, 32, 0.94)' },
      purple: { '50': 'rgba(139, 92, 246, 0.04)', '100': 'rgba(139, 92, 246, 0.08)', '200': 'rgba(139, 92, 246, 0.15)', '300': 'rgba(139, 92, 246, 0.25)', '400': 'rgba(139, 92, 246, 0.4)', '500': '#8b5cf6', '600': '#7c3aed', '700': 'rgba(124, 58, 237, 0.8)', '800': 'rgba(124, 58, 237, 0.9)' },
      semantic: { success: '#34d399', warning: '#f59e0b', error: '#B7372F', info: '#a1a1aa', highlight: '#B7372F', highlightBg: 'rgba(183, 55, 47, 0.14)' },
      border: { subtle: 'rgba(255, 255, 255, 0.12)', base: 'rgba(255, 255, 255, 0.18)', medium: 'rgba(255, 255, 255, 0.24)', strong: 'rgba(255, 255, 255, 0.32)', prominent: 'rgba(255, 255, 255, 0.40)' },
      element: { subtle: 'rgba(255, 255, 255, 0.06)', soft: 'rgba(255, 255, 255, 0.10)', base: 'rgba(255, 255, 255, 0.13)', medium: 'rgba(255, 255, 255, 0.17)', strong: 'rgba(255, 255, 255, 0.21)', elevated: 'rgba(255, 255, 255, 0.25)' },
    },
  },
  {
    id: 'light',
    name: 'Light',
    type: 'light',
    colors: {
      background: { primary: '#F8FAFC', secondary: '#FFFFFF', tertiary: '#F1F5F9', quaternary: '#E7ECF3', elevated: '#FFFFFF', workbench: '#F3F6FA', flowchat: '#FFFFFF', tooltip: 'rgba(255, 255, 255, 0.98)' },
      text: { primary: '#0F172A', secondary: '#253044', muted: '#5B6B8C', disabled: 'rgba(91, 107, 140, 0.56)' },
      accent: { '50': 'rgba(183, 55, 47, 0.045)', '100': 'rgba(183, 55, 47, 0.08)', '200': 'rgba(183, 55, 47, 0.13)', '300': 'rgba(183, 55, 47, 0.22)', '400': 'rgba(183, 55, 47, 0.42)', '500': '#B7372F', '600': '#9E2F29', '700': 'rgba(158, 47, 41, 0.88)', '800': 'rgba(128, 36, 32, 0.94)' },
      purple: { '50': 'rgba(91, 107, 140, 0.045)', '100': 'rgba(91, 107, 140, 0.08)', '200': 'rgba(91, 107, 140, 0.13)', '300': 'rgba(91, 107, 140, 0.2)', '400': 'rgba(91, 107, 140, 0.34)', '500': '#5B6B8C', '600': '#253044', '700': 'rgba(37, 48, 68, 0.82)', '800': 'rgba(15, 23, 42, 0.9)' },
      semantic: { success: '#4F8F67', warning: '#B8842B', error: '#B7372F', info: '#5B6B8C', highlight: '#B7372F', highlightBg: 'rgba(183, 55, 47, 0.11)' },
      border: { subtle: 'rgba(15, 23, 42, 0.08)', base: 'rgba(15, 23, 42, 0.12)', medium: 'rgba(15, 23, 42, 0.18)', strong: 'rgba(15, 23, 42, 0.28)', prominent: 'rgba(15, 23, 42, 0.38)' },
      element: { subtle: 'rgba(15, 23, 42, 0.035)', soft: 'rgba(15, 23, 42, 0.055)', base: 'rgba(15, 23, 42, 0.075)', medium: 'rgba(15, 23, 42, 0.105)', strong: 'rgba(15, 23, 42, 0.145)', elevated: 'rgba(255, 255, 255, 0.94)' },
    },
  },
  {
    id: 'sparo-china-style',
    name: 'Ink Charm',
    type: 'light',
    colors: {
      background: { primary: '#faf8f0', secondary: '#f5f3e8', tertiary: '#f0ede0', quaternary: '#ebe8d8', elevated: '#ebe9e3', workbench: '#faf8f0', flowchat: '#faf8f0', tooltip: 'rgba(250, 248, 240, 0.96)' },
      text: { primary: '#1a1a1a', secondary: '#3d3d3d', muted: '#6a6a6a', disabled: '#9a9a9a' },
      accent: { '50': 'rgba(46, 94, 138, 0.04)', '100': 'rgba(46, 94, 138, 0.08)', '200': 'rgba(46, 94, 138, 0.15)', '300': 'rgba(46, 94, 138, 0.25)', '400': 'rgba(46, 94, 138, 0.4)', '500': '#2e5e8a', '600': '#234a6d', '700': 'rgba(35, 74, 109, 0.8)', '800': 'rgba(35, 74, 109, 0.9)' },
      purple: { '50': 'rgba(126, 176, 155, 0.04)', '100': 'rgba(126, 176, 155, 0.08)', '200': 'rgba(126, 176, 155, 0.15)', '300': 'rgba(126, 176, 155, 0.25)', '400': 'rgba(126, 176, 155, 0.4)', '500': '#7eb09b', '600': '#5a9078', '700': 'rgba(90, 144, 120, 0.8)', '800': 'rgba(90, 144, 120, 0.9)' },
      semantic: { success: '#52ad5a', warning: '#f0a020', error: '#c8102e', info: '#2e5e8a', highlight: '#f0a020', highlightBg: 'rgba(240, 160, 32, 0.12)' },
      border: { subtle: 'rgba(106, 92, 70, 0.12)', base: 'rgba(106, 92, 70, 0.20)', medium: 'rgba(106, 92, 70, 0.28)', strong: 'rgba(106, 92, 70, 0.36)', prominent: 'rgba(106, 92, 70, 0.48)' },
      element: { subtle: 'rgba(46, 94, 138, 0.03)', soft: 'rgba(46, 94, 138, 0.06)', base: 'rgba(46, 94, 138, 0.10)', medium: 'rgba(46, 94, 138, 0.14)', strong: 'rgba(46, 94, 138, 0.18)', elevated: 'rgba(255, 255, 255, 0.85)' },
    },
  },
  {
    id: 'sparo-china-night',
    name: 'Ink Night',
    type: 'dark',
    colors: {
      background: { primary: '#1a1814', secondary: '#212019', tertiary: '#262420', quaternary: '#2d2926', elevated: '#2d2926', workbench: '#1a1814', flowchat: '#1a1814', tooltip: 'rgba(26, 24, 20, 0.95)' },
      text: { primary: '#e8e6e1', secondary: '#c5c3be', muted: '#928f89', disabled: '#5f5d59' },
      accent: { '50': 'rgba(115, 165, 204, 0.04)', '100': 'rgba(115, 165, 204, 0.08)', '200': 'rgba(115, 165, 204, 0.15)', '300': 'rgba(115, 165, 204, 0.25)', '400': 'rgba(115, 165, 204, 0.4)', '500': '#73a5cc', '600': '#5a8bb3', '700': 'rgba(90, 139, 179, 0.8)', '800': 'rgba(90, 139, 179, 0.9)' },
      purple: { '50': 'rgba(150, 198, 180, 0.04)', '100': 'rgba(150, 198, 180, 0.08)', '200': 'rgba(150, 198, 180, 0.15)', '300': 'rgba(150, 198, 180, 0.25)', '400': 'rgba(150, 198, 180, 0.4)', '500': '#96c6b4', '600': '#7aab98', '700': 'rgba(122, 171, 152, 0.8)', '800': 'rgba(122, 171, 152, 0.9)' },
      semantic: { success: '#6bc072', warning: '#f5b555', error: '#e85555', info: '#73a5cc', highlight: '#e6a84a', highlightBg: 'rgba(230, 168, 74, 0.15)' },
      border: { subtle: 'rgba(232, 230, 225, 0.10)', base: 'rgba(232, 230, 225, 0.16)', medium: 'rgba(232, 230, 225, 0.22)', strong: 'rgba(232, 230, 225, 0.28)', prominent: 'rgba(232, 230, 225, 0.38)' },
      element: { subtle: 'rgba(115, 165, 204, 0.06)', soft: 'rgba(115, 165, 204, 0.09)', base: 'rgba(115, 165, 204, 0.12)', medium: 'rgba(115, 165, 204, 0.16)', strong: 'rgba(115, 165, 204, 0.20)', elevated: 'rgba(45, 41, 38, 0.95)' },
    },
  },
  {
    id: 'sparo-cyber',
    name: 'Cyber',
    type: 'dark',
    colors: {
      background: { primary: '#101010', secondary: '#151515', tertiary: '#1a1a1a', quaternary: '#1f1f1f', elevated: '#0d0d0d', workbench: '#101010', flowchat: '#101010', tooltip: 'rgba(16, 16, 16, 0.95)' },
      text: { primary: '#e0f2ff', secondary: '#c7e7ff', muted: '#7fadcc', disabled: '#4a5a66' },
      accent: { '50': 'rgba(0, 230, 255, 0.05)', '100': 'rgba(0, 230, 255, 0.1)', '200': 'rgba(0, 230, 255, 0.18)', '300': 'rgba(0, 230, 255, 0.3)', '400': 'rgba(0, 230, 255, 0.45)', '500': '#00e6ff', '600': '#00ccff', '700': 'rgba(0, 204, 255, 0.85)', '800': 'rgba(0, 204, 255, 0.95)' },
      purple: { '50': 'rgba(138, 43, 226, 0.05)', '100': 'rgba(138, 43, 226, 0.1)', '200': 'rgba(138, 43, 226, 0.18)', '300': 'rgba(138, 43, 226, 0.3)', '400': 'rgba(138, 43, 226, 0.45)', '500': '#8a2be2', '600': '#7928ca', '700': 'rgba(121, 40, 202, 0.85)', '800': 'rgba(121, 40, 202, 0.95)' },
      semantic: { success: '#00ff9f', warning: '#ffcc00', error: '#ff0055', info: '#00e6ff', highlight: '#ffdd44', highlightBg: 'rgba(255, 221, 68, 0.15)' },
      border: { subtle: 'rgba(0, 230, 255, 0.14)', base: 'rgba(0, 230, 255, 0.20)', medium: 'rgba(0, 230, 255, 0.28)', strong: 'rgba(0, 230, 255, 0.36)', prominent: 'rgba(0, 230, 255, 0.50)' },
      element: { subtle: 'rgba(0, 230, 255, 0.06)', soft: 'rgba(0, 230, 255, 0.09)', base: 'rgba(0, 230, 255, 0.13)', medium: 'rgba(0, 230, 255, 0.17)', strong: 'rgba(0, 230, 255, 0.22)', elevated: 'rgba(0, 230, 255, 0.27)' },
    },
  },
  {
    id: 'slate',
    name: 'Slate',
    type: 'dark',
    colors: {
      background: { primary: '#14161a', secondary: '#22262c', tertiary: '#14161a', quaternary: '#2c3038', elevated: '#22262c', workbench: '#14161a', flowchat: '#22262c', tooltip: 'rgba(34, 38, 44, 0.96)' },
      text: { primary: '#eef0f3', secondary: '#c8ccd2', muted: '#9ea4ab', disabled: '#65696f' },
      accent: { '50': 'rgba(183, 55, 47, 0.05)', '100': 'rgba(183, 55, 47, 0.09)', '200': 'rgba(183, 55, 47, 0.14)', '300': 'rgba(183, 55, 47, 0.24)', '400': 'rgba(183, 55, 47, 0.42)', '500': '#B7372F', '600': '#9E2F29', '700': 'rgba(158, 47, 41, 0.88)', '800': 'rgba(128, 36, 32, 0.94)' },
      purple: { '50': 'rgba(184, 198, 255, 0.04)', '100': 'rgba(184, 198, 255, 0.08)', '200': 'rgba(184, 198, 255, 0.15)', '300': 'rgba(184, 198, 255, 0.25)', '400': 'rgba(184, 198, 255, 0.4)', '500': '#b8c4ff', '600': '#9dacf5', '700': 'rgba(157, 172, 245, 0.8)', '800': 'rgba(157, 172, 245, 0.9)' },
      semantic: { success: '#7fb899', warning: '#f59e0b', error: '#B7372F', info: '#a8b0bd', highlight: '#B7372F', highlightBg: 'rgba(183, 55, 47, 0.14)' },
      border: { subtle: 'rgba(255, 255, 255, 0.12)', base: 'rgba(255, 255, 255, 0.18)', medium: 'rgba(255, 255, 255, 0.24)', strong: 'rgba(255, 255, 255, 0.32)', prominent: 'rgba(255, 255, 255, 0.45)' },
      element: { subtle: 'rgba(255, 255, 255, 0.06)', soft: 'rgba(255, 255, 255, 0.10)', base: 'rgba(255, 255, 255, 0.13)', medium: 'rgba(255, 255, 255, 0.17)', strong: 'rgba(255, 255, 255, 0.21)', elevated: 'rgba(255, 255, 255, 0.25)' },
    },
  },
];

export const THEME_DISPLAY_ORDER: ThemeId[] = [
  'light',
  'slate',
  'dark',
  'sparo-china-style',
  'sparo-china-night',
  'sparo-cyber',
];

export function findInstallerThemeById(id: ThemeId): InstallerTheme {
  return THEMES.find((t) => t.id === id)
    ?? THEMES.find((t) => t.id === 'light')
    ?? THEMES[0];
}
