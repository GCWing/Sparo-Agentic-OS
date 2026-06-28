/**
 * Build Product App theme payload from main app ThemeConfig.
 * Maps host theme tokens to iframe CSS variables.
 *
 * --sparo-* is the canonical runtime namespace.
 */
import type { ThemeConfig, ThemeType } from '@/infrastructure/theme/types';

export interface SurfaceComponentThemePayload {
  type: ThemeType;
  id: string;
  vars: Record<string, string>;
}

export function buildSurfaceComponentThemeVars(theme: ThemeConfig | null): SurfaceComponentThemePayload | null {
  if (!theme) return null;

  const { colors, effects, typography } = theme;
  const vars: Record<string, string> = {};

  vars['--sparo-bg'] = colors.background.primary;
  vars['--sparo-bg-secondary'] = colors.background.secondary;
  vars['--sparo-bg-tertiary'] = colors.background.tertiary;
  vars['--sparo-bg-elevated'] = colors.background.elevated;
  vars['--sparo-bg-workbench'] = colors.background.workbench;
  vars['--sparo-bg-scene'] = colors.background.scene;

  vars['--sparo-text'] = colors.text.primary;
  vars['--sparo-text-secondary'] = colors.text.secondary;
  vars['--sparo-text-muted'] = colors.text.muted;
  vars['--sparo-text-disabled'] = colors.text.disabled;

  vars['--sparo-accent'] = colors.accent[500];
  vars['--sparo-accent-hover'] = colors.accent[600];
  vars['--sparo-accent-soft'] = colors.accent[100];
  vars['--sparo-accent-subtle'] = colors.accent[50];

  vars['--sparo-success'] = colors.semantic.success;
  vars['--sparo-success-bg'] = colors.semantic.successBg;
  vars['--sparo-success-border'] = colors.semantic.successBorder;
  vars['--sparo-warning'] = colors.semantic.warning;
  vars['--sparo-warning-bg'] = colors.semantic.warningBg;
  vars['--sparo-warning-border'] = colors.semantic.warningBorder;
  vars['--sparo-error'] = colors.semantic.error;
  vars['--sparo-error-bg'] = colors.semantic.errorBg;
  vars['--sparo-error-border'] = colors.semantic.errorBorder;
  vars['--sparo-info'] = colors.semantic.info;
  vars['--sparo-info-bg'] = colors.semantic.infoBg;
  vars['--sparo-info-border'] = colors.semantic.infoBorder;
  vars['--sparo-highlight'] = colors.semantic.highlight;
  vars['--sparo-highlight-bg'] = colors.semantic.highlightBg;

  vars['--sparo-border'] = colors.border.base;
  vars['--sparo-border-subtle'] = colors.border.subtle;
  vars['--sparo-border-medium'] = colors.border.medium;
  vars['--sparo-border-strong'] = colors.border.strong;

  vars['--sparo-element-subtle'] = colors.element.subtle;
  vars['--sparo-element-soft'] = colors.element.soft;
  vars['--sparo-element-bg'] = colors.element.base;
  vars['--sparo-element-hover'] = colors.element.medium;
  vars['--sparo-element-strong'] = colors.element.strong;
  vars['--sparo-element-elevated'] = colors.element.elevated;

  // Preferred semantic slots for generated Product Apps. These tell builders what a
  // color is for, reducing one-off palettes inside app CSS.
  vars['--sparo-app-bg'] = colors.background.scene || colors.background.primary;
  vars['--sparo-app-surface'] = colors.background.secondary;
  vars['--sparo-app-panel'] = colors.background.elevated;
  vars['--sparo-app-card'] = colors.element.subtle;
  vars['--sparo-app-card-hover'] = colors.element.soft;
  vars['--sparo-app-control-bg'] = colors.element.base;
  vars['--sparo-app-control-hover'] = colors.element.medium;
  vars['--sparo-app-text'] = colors.text.primary;
  vars['--sparo-app-text-secondary'] = colors.text.secondary;
  vars['--sparo-app-text-muted'] = colors.text.muted;
  vars['--sparo-app-border'] = colors.border.base;
  vars['--sparo-app-border-subtle'] = colors.border.subtle;
  vars['--sparo-app-accent'] = colors.accent[500];
  vars['--sparo-app-accent-hover'] = colors.accent[600];
  vars['--sparo-app-accent-soft'] = colors.accent[100];
  vars['--sparo-app-accent-text'] = theme.components?.button?.primary?.default?.color ?? colors.background.primary;
  vars['--sparo-app-focus-ring'] = colors.accent[300];
  vars['--sparo-app-selection'] = colors.semantic.highlightBg;
  vars['--sparo-app-overlay'] =
    theme.type === 'dark'
      ? 'color-mix(in srgb, var(--sparo-bg) 42%, transparent)'
      : 'color-mix(in srgb, var(--sparo-text) 18%, transparent)';

  if (effects?.radius) {
    vars['--sparo-radius-sm'] = effects.radius.sm;
    vars['--sparo-radius'] = effects.radius.base;
    vars['--sparo-radius-lg'] = effects.radius.lg;
    vars['--sparo-radius-xl'] = effects.radius.xl;
    vars['--sparo-app-radius-sm'] = effects.radius.sm;
    vars['--sparo-app-radius'] = effects.radius.base;
    vars['--sparo-app-radius-lg'] = effects.radius.lg;
  }

  if (effects?.shadow) {
    vars['--sparo-app-shadow-sm'] = effects.shadow.sm;
    vars['--sparo-app-shadow'] = effects.shadow.base;
  }

  if (typography?.font) {
    vars['--sparo-font-sans'] = typography.font.sans;
    vars['--sparo-font-mono'] = typography.font.mono;
  }

  if (colors.scrollbar) {
    vars['--sparo-scrollbar-thumb'] = colors.scrollbar.thumb;
    vars['--sparo-scrollbar-thumb-hover'] = colors.scrollbar.thumbHover;
  } else {
    vars['--sparo-scrollbar-thumb'] =
      theme.type === 'dark'
        ? 'color-mix(in srgb, var(--sparo-text) 12%, transparent)'
        : 'color-mix(in srgb, var(--sparo-text) 15%, transparent)';
    vars['--sparo-scrollbar-thumb-hover'] =
      theme.type === 'dark'
        ? 'color-mix(in srgb, var(--sparo-text) 22%, transparent)'
        : 'color-mix(in srgb, var(--sparo-text) 28%, transparent)';
  }

  return {
    type: theme.type,
    id: theme.id,
    vars,
  };
}
