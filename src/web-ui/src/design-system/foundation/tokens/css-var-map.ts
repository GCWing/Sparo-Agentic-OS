import { createDesignTokens, type ThemeConfig } from './token-contract';

export type CssVarMap = Record<string, string>;

function addScale(vars: CssVarMap, prefix: string, scale: Record<string | number, string | number>): void {
  Object.entries(scale).forEach(([key, value]) => {
    vars[`${prefix}-${key}`] = String(value);
  });
}

function addStatus(vars: CssVarMap, prefix: string, token: { fg: string; bg: string; border: string }): void {
  vars[`${prefix}-fg`] = token.fg;
  vars[`${prefix}-bg`] = token.bg;
  vars[`${prefix}-border`] = token.border;
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

export function createThemeCssVarMap(theme: ThemeConfig): CssVarMap {
  const tokens = createDesignTokens(theme);
  const vars: CssVarMap = {
    '--ds-color-bg-app': tokens.color.bg.app,
    '--ds-color-bg-scene': tokens.color.bg.scene,
    '--ds-color-bg-panel': tokens.color.bg.panel,
    '--ds-color-bg-elevated': tokens.color.bg.elevated,
    '--ds-color-bg-overlay': tokens.color.bg.overlay,
    '--ds-color-bg-tooltip': tokens.color.bg.tooltip,
    '--ds-color-text-primary': tokens.color.text.primary,
    '--ds-color-text-secondary': tokens.color.text.secondary,
    '--ds-color-text-muted': tokens.color.text.muted,
    '--ds-color-text-disabled': tokens.color.text.disabled,
    '--ds-color-text-inverse': tokens.color.text.inverse,
    '--ds-color-border-subtle': tokens.color.border.subtle,
    '--ds-color-border-base': tokens.color.border.base,
    '--ds-color-border-medium': tokens.color.border.medium,
    '--ds-color-border-strong': tokens.color.border.strong,
    '--ds-color-border-prominent': tokens.color.border.prominent,
    '--ds-color-border-focus': tokens.color.border.focus,
    '--ds-color-success': tokens.color.success.fg,
    '--ds-color-success-bg': tokens.color.success.bg,
    '--ds-color-success-border': tokens.color.success.border,
    '--ds-color-warning': tokens.color.warning.fg,
    '--ds-color-warning-bg': tokens.color.warning.bg,
    '--ds-color-warning-border': tokens.color.warning.border,
    '--ds-color-danger': tokens.color.danger.fg,
    '--ds-color-danger-bg': tokens.color.danger.bg,
    '--ds-color-danger-border': tokens.color.danger.border,
    '--ds-color-info': tokens.color.info.fg,
    '--ds-color-info-bg': tokens.color.info.bg,
    '--ds-color-info-border': tokens.color.info.border,
    '--ds-overlay-scrim': tokens.color.overlay.scrim,
    '--ds-overlay-scrim-strong': tokens.color.overlay.scrimStrong,
    '--ds-overlay-backdrop': tokens.color.overlay.backdrop,
    '--ds-focus-ring': tokens.color.focus.ring,
    '--ds-focus-ring-subtle': tokens.color.focus.ringSubtle,
    '--ds-focus-outline': tokens.color.focus.outline,
    '--ds-selection-bg': tokens.color.selection.bg,
    '--ds-selection-fg': tokens.color.selection.fg,
    '--ds-selection-inactive-bg': tokens.color.selection.inactiveBg,
    '--ds-shadow-color-subtle': tokens.color.shadowColor.subtle,
    '--ds-shadow-color-soft': tokens.color.shadowColor.soft,
    '--ds-shadow-color-card': tokens.color.shadowColor.card,
    '--ds-shadow-color-floating': tokens.color.shadowColor.floating,
    '--ds-shadow-color-popover': tokens.color.shadowColor.popover,
    '--ds-shadow-color-modal': tokens.color.shadowColor.modal,
    '--ds-shadow-color-strong': tokens.color.shadowColor.strong,
    '--ds-shadow-color-text': tokens.color.shadowColor.text,
    '--ds-diff-gutter-added': tokens.color.diff.gutter.added,
    '--ds-diff-gutter-deleted': tokens.color.diff.gutter.deleted,
    '--ds-diff-gutter-modified': tokens.color.diff.gutter.modified,
    '--ds-terminal-bg': tokens.color.terminal.bg,
    '--ds-terminal-fg': tokens.color.terminal.fg,
    '--ds-terminal-muted': tokens.color.terminal.muted,
    '--ds-terminal-prompt': tokens.color.terminal.prompt,
    '--ds-terminal-cursor': tokens.color.terminal.cursor,
    '--ds-terminal-selection': tokens.color.terminal.selection,
    '--ds-terminal-success': tokens.color.terminal.success,
    '--ds-terminal-warning': tokens.color.terminal.warning,
    '--ds-terminal-danger': tokens.color.terminal.danger,
    '--ds-markdown-link': tokens.color.markdown.link,
    '--ds-markdown-table-header-bg': tokens.color.markdown.table.headerBg,
    '--ds-markdown-table-border': tokens.color.markdown.table.border,
    '--ds-markdown-table-row-hover-bg': tokens.color.markdown.table.rowHoverBg,
    '--ds-markdown-hr': tokens.color.markdown.hr,
    '--ds-radius-xs': tokens.radius.xs,
    '--ds-radius-sm': tokens.radius.sm,
    '--ds-radius-md': tokens.radius.md,
    '--ds-radius-lg': tokens.radius.lg,
    '--ds-radius-xl': tokens.radius.xl,
    '--ds-radius-full': tokens.radius.full,
    '--ds-z-underlay': String(tokens.zIndex.underlay),
    '--ds-z-base': String(tokens.zIndex.base),
    '--ds-z-local': String(tokens.zIndex.local),
    '--ds-z-raised': String(tokens.zIndex.raised),
    '--ds-z-header': String(tokens.zIndex.header),
    '--ds-z-sticky': String(tokens.zIndex.sticky),
    '--ds-z-floating': String(tokens.zIndex.floating),
    '--ds-z-dropdown': String(tokens.zIndex.dropdown),
    '--ds-z-scrim': String(tokens.zIndex.scrim),
    '--ds-z-overlay': String(tokens.zIndex.overlay),
    '--ds-z-drawer': String(tokens.zIndex.drawer),
    '--ds-z-dialog': String(tokens.zIndex.dialog),
    '--ds-z-modal': String(tokens.zIndex.dialog),
    '--ds-z-fullscreen': String(tokens.zIndex.fullscreen),
    '--ds-z-toast': String(tokens.zIndex.toast),
    '--ds-z-popover': String(tokens.zIndex.popover),
    '--ds-z-tooltip': String(tokens.zIndex.tooltip),
    '--ds-z-notification': String(tokens.zIndex.notification),
    '--ds-z-context-menu': String(tokens.zIndex.contextMenu),
  };

  addStatus(vars, '--ds-diff-added', tokens.color.diff.added);
  addStatus(vars, '--ds-diff-deleted', tokens.color.diff.deleted);
  addStatus(vars, '--ds-diff-modified', tokens.color.diff.modified);
  addStatus(vars, '--ds-diff-unchanged', tokens.color.diff.unchanged);
  Object.entries(tokens.color.syntax).forEach(([name, value]) => {
    vars[`--ds-syntax-${name}`] = value;
  });
  Object.entries(tokens.color.language).forEach(([name, value]) => {
    addStatus(vars, `--ds-language-${name}`, value);
  });
  Object.entries(tokens.color.toolFamily).forEach(([name, value]) => {
    addStatus(vars, `--ds-tool-family-${name}`, value);
  });
  addStatus(vars, '--ds-markdown-inline-code', tokens.color.markdown.inlineCode);
  addStatus(vars, '--ds-markdown-code-block', tokens.color.markdown.codeBlock);
  addStatus(vars, '--ds-markdown-blockquote', tokens.color.markdown.blockquote);
  Object.entries(tokens.color.statusSurface).forEach(([name, value]) => {
    addStatus(vars, `--ds-status-surface-${name}`, value);
  });

  addScale(vars, '--ds-color-accent', tokens.color.accent);
  addScale(vars, '--ds-color-purple', tokens.color.purple);
  addScale(vars, '--ds-color-element', tokens.color.element);
  addScale(vars, '--ds-space', tokens.space);
  addScale(vars, '--ds-font-size', tokens.typography.size);
  addScale(vars, '--ds-font-weight', tokens.typography.weight);
  addScale(vars, '--ds-line-height', tokens.typography.lineHeight);
  addScale(vars, '--ds-shadow', tokens.shadow);
  vars['--ds-shadow-card'] = tokens.shadow.lg ?? tokens.shadow.base ?? `0 4px 12px ${tokens.color.shadowColor.card}`;
  vars['--ds-shadow-floating'] = tokens.shadow.xl ?? tokens.shadow.lg ?? `0 12px 32px ${tokens.color.shadowColor.floating}`;
  vars['--ds-shadow-popover'] = `0 8px 24px ${tokens.color.shadowColor.popover}`;
  vars['--ds-shadow-modal'] = tokens.shadow['2xl'] ?? tokens.shadow.xl ?? `0 16px 40px ${tokens.color.shadowColor.modal}`;
  addScale(vars, '--ds-motion', tokens.motion.duration);
  addScale(vars, '--ds-easing', tokens.motion.easing);

  vars['--ds-font-family-sans'] = tokens.typography.family.sans;
  vars['--ds-font-family-mono'] = tokens.typography.family.mono;

  const primaryRgb = toRgbChannels(String(tokens.color.accent[500]));
  if (primaryRgb) {
    vars['--ds-color-accent-rgb'] = primaryRgb;
  }

  return vars;
}
