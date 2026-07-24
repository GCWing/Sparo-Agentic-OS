import { systemIconGlyphMarkup } from './raw-icons';
import type { SystemIconName, SystemIconVariant } from './icon-manifest';
import {
  SPARO_ICON_DEFAULT_SIZE,
  SPARO_ICON_DEFAULT_STROKE_WIDTH,
  SPARO_ICON_EMPHASIS_BACKGROUND_INSET,
  SPARO_ICON_EMPHASIS_DEFAULT_CORNER_RADIUS,
  SPARO_ICON_EMPHASIS_MAX_CORNER_RADIUS,
  SPARO_ICON_EMPHASIS_RADIUS,
  SPARO_ICON_EMPHASIS_SCALE,
  SPARO_ICON_EMPHASIS_TRANSLATE,
  SPARO_ICON_VIEWBOX_SIZE,
  type SparoIconBackgroundShape,
} from './icon-spec';

export interface RenderSystemIconSvgOptions {
  name: SystemIconName;
  variant?: SystemIconVariant;
  size?: number;
  color?: string;
  backgroundColor?: string;
  backgroundShape?: SparoIconBackgroundShape;
  backgroundRadius?: number;
  strokeWidth?: number;
  absoluteStrokeWidth?: boolean;
  title?: string;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function renderSystemIconSvg({
  name,
  variant = 'base',
  size = SPARO_ICON_DEFAULT_SIZE,
  color = '#111111',
  backgroundColor = '#d9231b',
  backgroundShape = 'circle',
  backgroundRadius = SPARO_ICON_EMPHASIS_DEFAULT_CORNER_RADIUS,
  strokeWidth = SPARO_ICON_DEFAULT_STROKE_WIDTH,
  absoluteStrokeWidth = false,
  title,
}: RenderSystemIconSvgOptions): string {
  const safeColor = escapeAttribute(color);
  const safeBackground = escapeAttribute(backgroundColor);
  const resolvedStrokeWidth = absoluteStrokeWidth
    ? strokeWidth * (SPARO_ICON_VIEWBOX_SIZE / size)
    : strokeWidth;
  const emphasisStrokeWidth = resolvedStrokeWidth / SPARO_ICON_EMPHASIS_SCALE;
  const resolvedBackgroundRadius = Number.isFinite(backgroundRadius)
    ? Math.min(Math.max(backgroundRadius, 0), SPARO_ICON_EMPHASIS_MAX_CORNER_RADIUS)
    : SPARO_ICON_EMPHASIS_DEFAULT_CORNER_RADIUS;
  const titleMarkup = title ? `\n  <title>${escapeAttribute(title)}</title>` : '';
  const body = systemIconGlyphMarkup[name]
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');

  if (variant === 'emphasis') {
    const backgroundMarkup = backgroundShape === 'circle'
      ? `<circle cx="${SPARO_ICON_VIEWBOX_SIZE / 2}" cy="${SPARO_ICON_VIEWBOX_SIZE / 2}" r="${SPARO_ICON_EMPHASIS_RADIUS}" fill="${safeBackground}" />`
      : `<rect x="${SPARO_ICON_EMPHASIS_BACKGROUND_INSET}" y="${SPARO_ICON_EMPHASIS_BACKGROUND_INSET}" width="${SPARO_ICON_VIEWBOX_SIZE - SPARO_ICON_EMPHASIS_BACKGROUND_INSET * 2}" height="${SPARO_ICON_VIEWBOX_SIZE - SPARO_ICON_EMPHASIS_BACKGROUND_INSET * 2}" rx="${resolvedBackgroundRadius}" fill="${safeBackground}" />`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${SPARO_ICON_VIEWBOX_SIZE} ${SPARO_ICON_VIEWBOX_SIZE}" fill="none" data-sparo-icon="${name}" data-sparo-variant="emphasis">${titleMarkup}
  ${backgroundMarkup}
  <g transform="translate(${SPARO_ICON_EMPHASIS_TRANSLATE} ${SPARO_ICON_EMPHASIS_TRANSLATE}) scale(${SPARO_ICON_EMPHASIS_SCALE})" stroke="${safeColor}" stroke-width="${emphasisStrokeWidth}" stroke-linecap="round" stroke-linejoin="round">
${body}
  </g>
</svg>\n`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${SPARO_ICON_VIEWBOX_SIZE} ${SPARO_ICON_VIEWBOX_SIZE}" fill="none" stroke="${safeColor}" stroke-width="${resolvedStrokeWidth}" stroke-linecap="round" stroke-linejoin="round" data-sparo-icon="${name}" data-sparo-variant="base">${titleMarkup}
${body}
</svg>\n`;
}
