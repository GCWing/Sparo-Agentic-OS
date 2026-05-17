/**
 * Design tokens — canonical schema + resolver helpers.
 *
 * Mirrors the Rust `CanonicalTokens` struct in `design_artifact_tool.rs` and
 * the documented schema in `prompts/design_mode.md`. Any new key has to be
 * added in BOTH places; this file is the single entry point every UI surface
 * (Proposal card, Studio, Canvas preview) reads from so nobody hand-rolls
 * their own "pick('primary', 'accent', 'brand', ...)" cascade.
 *
 * If the `DesignTokens` tool is ever extended with a new canonical key, add it
 * here, to `CanonicalTokens` in Rust, and to the prompt's schema bullet list.
 */

import type { DesignTokenProposal } from './store/designTokensStore';

// -------------------------------- Resolve ---------------------------------


/** Read the first non-empty string value across a list of candidate keys. */
export function pickString(
  source: Record<string, unknown> | undefined | null,
  ...keys: string[]
): string | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const v = source[key];
    if (typeof v === 'string' && v.trim().length > 0) return v;
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

/**
 * Resolve a proposal into the canonical (flat) CSS-variable map. All tokens are
 * optional and come with a neutral fallback so a partial proposal still renders
 * a coherent system rather than a mess of `undefined`s.
 *
 * The variable names match `render_tokens_css` in the Rust tool; the preview
 * iframe's scaffold uses the same names.
 */
export interface ResolvedTokens {
  // Typography
  '--dt-font-family': string;
  '--dt-font-family-mono': string;
  '--dt-font-display': string;
  '--dt-font-headline': string;
  '--dt-font-title': string;
  '--dt-font-body': string;
  '--dt-font-caption': string;
  // Colors (surface-agnostic by default — callers that need a light/dark
  // preview should override `--dt-background` / `--dt-surface` / text vars).
  '--dt-background': string;
  '--dt-surface': string;
  '--dt-surface-elevated': string;
  '--dt-border': string;
  '--dt-text': string;
  '--dt-text-secondary': string;
  '--dt-text-muted': string;
  '--dt-primary': string;
  '--dt-primary-hover': string;
  '--dt-accent': string;
  '--dt-success': string;
  '--dt-warning': string;
  '--dt-danger': string;
  // Radius
  '--dt-radius-sm': string;
  '--dt-radius-md': string;
  '--dt-radius-lg': string;
  '--dt-radius-full': string;
  // Shadow
  '--dt-shadow-sm': string;
  '--dt-shadow-md': string;
  '--dt-shadow-lg': string;
  // Spacing
  '--dt-space-xs': string;
  '--dt-space-sm': string;
  '--dt-space-md': string;
  '--dt-space-lg': string;
  '--dt-space-xl': string;
  // Motion
  '--dt-duration': string;
  '--dt-ease': string;
}

/** Light-/dark-surface override helper for the Studio & Proposal card preview. */
export interface SurfaceOverride {
  background: string;
  surface: string;
  surfaceElevated: string;
  border: string;
  text: string;
  textSecondary: string;
  textMuted: string;
}

// Source defaults for the artifact token schema. These values are intentionally
// literal because generated design artifacts may render outside the app shell.
const DESIGN_TOKEN_SOURCE_DEFAULTS = {
  lightBackground: '#f7f7f5',
  lightSurface: '#ffffff',
  lightSurfaceElevated: '#ffffff',
  lightBorder: 'rgba(12, 13, 16, 0.09)',
  lightText: '#0c0d10',
  lightTextSecondary: 'rgba(12, 13, 16, 0.72)',
  lightTextMuted: 'rgba(12, 13, 16, 0.55)',
  darkBackground: '#0b0b0d',
  darkSurface: '#141418',
  darkSurfaceElevated: '#1a1c21',
  darkBorder: 'rgba(255, 255, 255, 0.09)',
  darkText: '#f5f7fb',
  darkTextSecondary: 'rgba(245, 247, 251, 0.72)',
  darkTextMuted: 'rgba(245, 247, 251, 0.55)',
  background: '#ffffff',
  surface: '#fafafa',
  surfaceElevated: '#ffffff',
  border: 'rgba(17, 17, 17, 0.08)',
  text: '#0b0b0c',
  textSecondary: 'rgba(11, 11, 12, 0.72)',
  textMuted: 'rgba(11, 11, 12, 0.52)',
  primary: '#0b0b0c',
  success: '#16a34a',
  warning: '#d97706',
  danger: '#dc2626',
  shadowSm: '0 1px 2px rgba(0,0,0,0.06)',
  shadowMd: '0 4px 14px rgba(0,0,0,0.10)',
  shadowLg: '0 18px 40px rgba(0,0,0,0.18)',
} as const;

export const LIGHT_SURFACE: SurfaceOverride = {
  background: `var(--ds-design-token-light-background, ${DESIGN_TOKEN_SOURCE_DEFAULTS.lightBackground})`,
  surface: `var(--ds-design-token-light-surface, ${DESIGN_TOKEN_SOURCE_DEFAULTS.lightSurface})`,
  surfaceElevated: `var(--ds-design-token-light-surface-elevated, ${DESIGN_TOKEN_SOURCE_DEFAULTS.lightSurfaceElevated})`,
  border: `var(--ds-design-token-light-border, ${DESIGN_TOKEN_SOURCE_DEFAULTS.lightBorder})`,
  text: `var(--ds-design-token-light-text, ${DESIGN_TOKEN_SOURCE_DEFAULTS.lightText})`,
  textSecondary: `var(--ds-design-token-light-text-secondary, ${DESIGN_TOKEN_SOURCE_DEFAULTS.lightTextSecondary})`,
  textMuted: `var(--ds-design-token-light-text-muted, ${DESIGN_TOKEN_SOURCE_DEFAULTS.lightTextMuted})`,
};

export const DARK_SURFACE: SurfaceOverride = {
  background: `var(--ds-design-token-dark-background, ${DESIGN_TOKEN_SOURCE_DEFAULTS.darkBackground})`,
  surface: `var(--ds-design-token-dark-surface, ${DESIGN_TOKEN_SOURCE_DEFAULTS.darkSurface})`,
  surfaceElevated: `var(--ds-design-token-dark-surface-elevated, ${DESIGN_TOKEN_SOURCE_DEFAULTS.darkSurfaceElevated})`,
  border: `var(--ds-design-token-dark-border, ${DESIGN_TOKEN_SOURCE_DEFAULTS.darkBorder})`,
  text: `var(--ds-design-token-dark-text, ${DESIGN_TOKEN_SOURCE_DEFAULTS.darkText})`,
  textSecondary: `var(--ds-design-token-dark-text-secondary, ${DESIGN_TOKEN_SOURCE_DEFAULTS.darkTextSecondary})`,
  textMuted: `var(--ds-design-token-dark-text-muted, ${DESIGN_TOKEN_SOURCE_DEFAULTS.darkTextMuted})`,
};

export function resolveTokens(
  proposal: Partial<DesignTokenProposal> | undefined | null
): ResolvedTokens {
  const colors = (proposal?.colors ?? {}) as Record<string, string>;
  const typography = (proposal?.typography ?? {}) as Record<string, any>;
  const scale = (typography?.scale ?? {}) as Record<string, any>;
  const radius = (proposal?.radius ?? {}) as Record<string, any>;
  const shadow = (proposal?.shadow ?? {}) as Record<string, any>;
  const spacing = (proposal?.spacing ?? {}) as Record<string, any>;
  const motion = (proposal?.motion ?? {}) as Record<string, any>;
  const motionDuration = (motion?.duration ?? {}) as Record<string, any>;

  const primary =
    pickString(colors, 'primary', 'accent', 'brand') ??
    `var(--ds-design-token-primary, ${DESIGN_TOKEN_SOURCE_DEFAULTS.primary})`;

  return {
    '--dt-font-family':
      pickString(typography, 'fontFamily', 'family') ??
      'Inter, system-ui, -apple-system, sans-serif',
    '--dt-font-family-mono':
      pickString(typography, 'fontFamilyMono', 'familyMono') ??
      'ui-monospace, SFMono-Regular, Menlo, monospace',
    '--dt-font-display': pickString(scale, 'display', 'headline', 'title') ?? '48px',
    '--dt-font-headline': pickString(scale, 'headline', 'display', 'title') ?? '32px',
    '--dt-font-title': pickString(scale, 'title', 'heading') ?? '20px',
    '--dt-font-body': pickString(scale, 'body', 'base') ?? '15px',
    '--dt-font-caption': pickString(scale, 'caption', 'small') ?? '12px',

    '--dt-background':
      pickString(colors, 'background', 'bg') ??
      `var(--ds-design-token-background, ${DESIGN_TOKEN_SOURCE_DEFAULTS.background})`,
    '--dt-surface':
      pickString(colors, 'surface') ??
      `var(--ds-design-token-surface, ${DESIGN_TOKEN_SOURCE_DEFAULTS.surface})`,
    '--dt-surface-elevated':
      pickString(colors, 'surfaceElevated', 'surface_elevated') ??
      `var(--ds-design-token-surface-elevated, ${DESIGN_TOKEN_SOURCE_DEFAULTS.surfaceElevated})`,
    '--dt-border':
      pickString(colors, 'border') ??
      `var(--ds-design-token-border, ${DESIGN_TOKEN_SOURCE_DEFAULTS.border})`,
    '--dt-text':
      pickString(colors, 'text', 'textPrimary', 'text_primary') ??
      `var(--ds-design-token-text, ${DESIGN_TOKEN_SOURCE_DEFAULTS.text})`,
    '--dt-text-secondary':
      pickString(colors, 'textSecondary', 'text_secondary') ??
      `var(--ds-design-token-text-secondary, ${DESIGN_TOKEN_SOURCE_DEFAULTS.textSecondary})`,
    '--dt-text-muted':
      pickString(colors, 'textMuted', 'text_muted') ??
      `var(--ds-design-token-text-muted, ${DESIGN_TOKEN_SOURCE_DEFAULTS.textMuted})`,
    '--dt-primary': primary,
    '--dt-primary-hover':
      pickString(colors, 'primaryHover', 'primary_hover') ?? primary,
    '--dt-accent': pickString(colors, 'accent', 'primary', 'brand') ?? primary,
    '--dt-success':
      pickString(colors, 'success') ??
      `var(--ds-design-token-success, ${DESIGN_TOKEN_SOURCE_DEFAULTS.success})`,
    '--dt-warning':
      pickString(colors, 'warning') ??
      `var(--ds-design-token-warning, ${DESIGN_TOKEN_SOURCE_DEFAULTS.warning})`,
    '--dt-danger':
      pickString(colors, 'danger', 'error') ??
      `var(--ds-design-token-danger, ${DESIGN_TOKEN_SOURCE_DEFAULTS.danger})`,

    '--dt-radius-sm': pickString(radius, 'sm', 'xs') ?? '4px',
    '--dt-radius-md': pickString(radius, 'md', 'base') ?? '8px',
    '--dt-radius-lg': pickString(radius, 'lg') ?? '16px',
    '--dt-radius-full': pickString(radius, 'full', 'pill') ?? '999px',

    '--dt-shadow-sm':
      pickString(shadow, 'sm') ??
      `var(--ds-design-token-shadow-sm, ${DESIGN_TOKEN_SOURCE_DEFAULTS.shadowSm})`,
    '--dt-shadow-md':
      pickString(shadow, 'md', 'base') ??
      `var(--ds-design-token-shadow-md, ${DESIGN_TOKEN_SOURCE_DEFAULTS.shadowMd})`,
    '--dt-shadow-lg':
      pickString(shadow, 'lg') ??
      `var(--ds-design-token-shadow-lg, ${DESIGN_TOKEN_SOURCE_DEFAULTS.shadowLg})`,

    '--dt-space-xs': pickString(spacing, 'xs') ?? '4px',
    '--dt-space-sm': pickString(spacing, 'sm', 'xs') ?? '8px',
    '--dt-space-md': pickString(spacing, 'md', 'base') ?? '16px',
    '--dt-space-lg': pickString(spacing, 'lg') ?? '24px',
    '--dt-space-xl': pickString(spacing, 'xl', 'lg') ?? '40px',

    '--dt-duration': pickString(motionDuration, 'normal', 'base', 'md') ?? '200ms',
    '--dt-ease': pickString(motion, 'ease') ?? 'cubic-bezier(0.4, 0, 0.2, 1)',
  };
}

/** Apply a light/dark surface override to an existing resolved token map. */
export function applySurface(
  base: ResolvedTokens,
  surface: SurfaceOverride
): ResolvedTokens {
  return {
    ...base,
    '--dt-background': surface.background,
    '--dt-surface': surface.surface,
    '--dt-surface-elevated': surface.surfaceElevated,
    '--dt-border': surface.border,
    '--dt-text': surface.text,
    '--dt-text-secondary': surface.textSecondary,
    '--dt-text-muted': surface.textMuted,
  };
}

// -------------------------- Store key canonicalization --------------------

/**
 * Canonical key used by `useDesignTokensStore.byScope`. Must match whatever
 * `DesignTokens.propose` returns in `data.path`, so:
 *
 *   - If the backend echoes an absolute path we keep it as-is (after separator
 *     normalization).
 *   - Otherwise we derive a deterministic key from workspace + artifact id.
 *
 * This removes the subtle bug where `DesignTokensStudio` fell back to
 * `Object.values(docs)[0]` because its computed scopePath didn't match the
 * path the backend emitted.
 */
export function canonicalScopeKey(input: {
  explicitPath?: string | null;
  workspacePath?: string | null;
  artifactId?: string | null;
}): string {
  const { explicitPath, workspacePath, artifactId } = input;
  if (explicitPath && typeof explicitPath === 'string') {
    return explicitPath.replace(/\\/g, '/');
  }
  const ws = (workspacePath || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (artifactId) {
    return ws ? `${ws}/.design/${artifactId}/tokens.json` : `artifact:${artifactId}`;
  }
  return ws ? `${ws}/.design/tokens.json` : 'workspace';
}
