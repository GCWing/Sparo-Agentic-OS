import type { ThemeConfig } from './token-contract';
import type { CssVarMap } from './css-var-map';

function addScale(vars: CssVarMap, prefix: string, scale: object): void {
  Object.entries(scale).forEach(([key, value]) => {
    vars[`${prefix}-${key}`] = String(value);
  });
}

function toRgbChannels(color: string): string | null {
  const trimmed = color.trim();
  const hex6 = /^#([0-9a-f]{6})$/i.exec(trimmed);
  if (hex6) {
    const n = parseInt(hex6[1], 16);
    return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(trimmed);
  if (rgb) {
    return `${rgb[1]} ${rgb[2]} ${rgb[3]}`;
  }
  return null;
}

export function createLegacyCssVarMap(theme: ThemeConfig): CssVarMap {
  const { colors, effects, motion, typography } = theme;
  const vars: CssVarMap = {
    '--color-bg-primary': colors.background.primary,
    '--color-bg-secondary': colors.background.secondary,
    '--color-bg-tertiary': colors.background.tertiary,
    '--color-bg-quaternary': colors.background.quaternary,
    '--color-bg-elevated': colors.background.elevated,
    '--color-bg-workbench': colors.background.workbench,
    '--color-bg-scene': colors.background.scene,
    '--color-bg-flowchat': colors.background.scene,
    '--color-overlay': 'var(--ds-overlay-scrim)',
    '--color-text-primary': colors.text.primary,
    '--color-text-secondary': colors.text.secondary,
    '--color-text-muted': colors.text.muted,
    '--color-text-disabled': colors.text.disabled,
    '--color-primary': colors.accent[500],
    '--color-primary-hover': colors.accent[600],
    '--color-accent': colors.accent[500],
    '--color-accent-primary': colors.accent[500],
    '--color-success': colors.semantic.success,
    '--color-success-bg': colors.semantic.successBg,
    '--color-success-border': colors.semantic.successBorder,
    '--color-warning': colors.semantic.warning,
    '--color-warning-bg': colors.semantic.warningBg,
    '--color-warning-border': colors.semantic.warningBorder,
    '--color-error': colors.semantic.error,
    '--color-error-bg': colors.semantic.errorBg,
    '--color-error-border': colors.semantic.errorBorder,
    '--color-info': colors.semantic.info,
    '--color-info-bg': colors.semantic.infoBg,
    '--color-info-border': colors.semantic.infoBorder,
    '--color-highlight': colors.semantic.highlight,
    '--color-highlight-bg': colors.semantic.highlightBg,
    '--border-subtle': colors.border.subtle,
    '--border-base': colors.border.base,
    '--border-medium': colors.border.medium,
    '--border-strong': colors.border.strong,
    '--border-prominent': colors.border.prominent,
    '--scene-viewport-border-width': theme.layout?.sceneViewportBorder ?? true ? '1px' : '0',
    '--element-bg-subtle': colors.element.subtle,
    '--element-bg-soft': colors.element.soft,
    '--element-bg-base': colors.element.base,
    '--element-bg-medium': colors.element.medium,
    '--element-bg-strong': colors.element.strong,
    '--element-bg-elevated': colors.element.elevated,
    '--git-color-branch': colors.git.branch,
    '--git-color-branch-bg': colors.git.branchBg,
    '--git-color-changes': colors.git.changes,
    '--git-color-changes-bg': colors.git.changesBg,
    '--git-color-added': colors.git.added,
    '--git-color-added-bg': colors.git.addedBg,
    '--git-color-deleted': colors.git.deleted,
    '--git-color-deleted-bg': colors.git.deletedBg,
    '--git-color-staged': colors.git.staged,
    '--git-color-staged-bg': colors.git.stagedBg,
    '--scrollbar-thumb': colors.scrollbar?.thumb ?? (theme.type === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.15)'),
    '--scrollbar-thumb-hover': colors.scrollbar?.thumbHover ?? (theme.type === 'dark' ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.28)'),
    '--glow-blue': effects.glow.blue,
    '--glow-purple': effects.glow.purple,
    '--glow-mixed': effects.glow.mixed,
    '--opacity-disabled': String(effects.opacity.disabled),
    '--opacity-hover': String(effects.opacity.hover),
    '--opacity-focus': String(effects.opacity.focus),
    '--opacity-overlay': String(effects.opacity.overlay),
    '--font-sans': typography.font.sans,
    '--font-mono': typography.font.mono,
  };

  if (colors.background.tooltip) {
    vars['--color-bg-tooltip'] = colors.background.tooltip;
  }

  const primaryRgb = toRgbChannels(colors.accent[500]);
  if (primaryRgb) {
    vars['--color-primary-rgb'] = primaryRgb;
  }

  addScale(vars, '--color-accent', colors.accent);
  if (colors.purple) {
    addScale(vars, '--color-purple', colors.purple);
  }
  addScale(vars, '--shadow', effects.shadow);
  addScale(vars, '--blur', effects.blur);
  addScale(vars, '--radius', effects.radius);
  addScale(vars, '--spacing', effects.spacing);
  addScale(vars, '--motion', motion.duration);
  addScale(vars, '--easing', motion.easing);
  addScale(vars, '--font-weight', typography.weight);
  addScale(vars, '--font-size', typography.size);
  addScale(vars, '--line-height', typography.lineHeight);

  return vars;
}
