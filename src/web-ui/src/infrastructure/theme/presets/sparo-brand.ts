/**
 * Product UI roles derived from the canonical Sparo Core Red (#E53935).
 *
 * The logo keeps the canonical color. Solid controls use a darker action red
 * so white labels meet WCAG AA. Focus rings are theme-specific so they remain
 * visible against both light and dark surfaces.
 */
export const SPARO_BRAND = {
  core: '#E53935',
  action: '#C62828',
  actionHover: '#B71C1C',
  actionActive: '#981B1B',
  onAction: '#FFFFFF',
} as const;

export const SPARO_BRAND_FOCUS_RING = {
  light: SPARO_BRAND.action,
  dark: '#FF6B64',
} as const;

/** Build translucent roles from a canonical brand color without duplicating RGB literals. */
export function sparoBrandAlpha(color: string, alpha: number): string {
  const normalized = color.replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    throw new Error(`Expected a six-digit hex color, received: ${color}`);
  }

  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  const clampedAlpha = Math.min(1, Math.max(0, alpha));
  return `rgba(${red}, ${green}, ${blue}, ${clampedAlpha})`;
}
