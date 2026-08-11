import { describe, expect, it } from 'vitest';
import { createThemeCssVarMap } from '@/design-system';
import { darkTheme } from './dark-theme';
import { lightTheme } from './light-theme';
import { SPARO_BRAND, SPARO_BRAND_FOCUS_RING, sparoBrandAlpha } from './sparo-brand';

function relativeLuminance(hex: string): number {
  const channels = hex
    .match(/[a-f\d]{2}/gi)
    ?.map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4
    ));

  if (!channels || channels.length !== 3) {
    throw new Error(`Expected a six-digit hex color, received ${hex}`);
  }

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Sparo brand theme roles', () => {
  it('keeps the logo core red separate from the accessible action role', () => {
    const lightVars = createThemeCssVarMap(lightTheme);

    expect(lightVars['--ds-color-brand-core']).toBe('#E53935');
    expect(lightVars['--ds-color-brand-action']).toBe(SPARO_BRAND.action);
    expect(lightVars['--ds-color-danger']).toBe(SPARO_BRAND.action);
    expect(lightTheme.components?.button?.primary.default.background)
      .toBe(SPARO_BRAND.action);
  });

  it('meets contrast requirements for action labels and focus indicators', () => {
    expect(contrastRatio(SPARO_BRAND.onAction, SPARO_BRAND.action)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(SPARO_BRAND_FOCUS_RING.light, lightTheme.colors.background.secondary))
      .toBeGreaterThanOrEqual(3);
    expect(contrastRatio(SPARO_BRAND_FOCUS_RING.dark, darkTheme.colors.background.secondary))
      .toBeGreaterThanOrEqual(3);
  });

  it('uses one high-contrast red role for focus and danger on dark surfaces', () => {
    const darkVars = createThemeCssVarMap(darkTheme);

    expect(darkVars['--ds-focus-ring']).toBe(SPARO_BRAND_FOCUS_RING.dark);
    expect(darkVars['--ds-color-danger']).toBe(SPARO_BRAND_FOCUS_RING.dark);
  });

  it('derives translucent roles from canonical colors instead of separate red literals', () => {
    expect(sparoBrandAlpha(SPARO_BRAND.action, 0.12)).toBe('rgba(198, 40, 40, 0.12)');
    expect(lightTheme.colors.semantic.errorBg).toBe(sparoBrandAlpha(SPARO_BRAND.action, 0.09));
    expect(darkTheme.colors.semantic.errorBg)
      .toBe(sparoBrandAlpha(SPARO_BRAND_FOCUS_RING.dark, 0.12));
  });
});
