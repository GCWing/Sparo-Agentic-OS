import { forwardRef, useId, type CSSProperties, type SVGProps } from 'react';
import { systemIconGlyphMarkup } from '../raw-icons';
import type { SystemIconName, SystemIconVariant } from '../icon-manifest';
import {
  SPARO_ICON_DEFAULT_SIZE,
  SPARO_ICON_DEFAULT_STROKE_WIDTH,
  SPARO_ICON_DETAIL_STROKE_RATIO,
  SPARO_ICON_EMPHASIS_BACKGROUND_INSET,
  SPARO_ICON_EMPHASIS_DEFAULT_CORNER_RADIUS,
  SPARO_ICON_EMPHASIS_MAX_CORNER_RADIUS,
  SPARO_ICON_EMPHASIS_RADIUS,
  SPARO_ICON_EMPHASIS_SCALE,
  SPARO_ICON_EMPHASIS_TRANSLATE,
  SPARO_ICON_VIEWBOX_SIZE,
  type SparoIconBackgroundShape,
} from '../icon-spec';

export interface SparoSystemIconProps
  extends Omit<SVGProps<SVGSVGElement>, 'color' | 'name'> {
  name: SystemIconName;
  variant?: SystemIconVariant;
  size?: number | string;
  color?: string;
  backgroundColor?: string;
  backgroundShape?: SparoIconBackgroundShape;
  backgroundRadius?: number;
  strokeWidth?: number;
  absoluteStrokeWidth?: boolean;
  title?: string;
}

export const SparoSystemIcon = forwardRef<SVGSVGElement, SparoSystemIconProps>(({
  name,
  variant = 'base',
  size = SPARO_ICON_DEFAULT_SIZE,
  color = 'currentColor',
  backgroundColor = '#d9231b',
  backgroundShape = 'circle',
  backgroundRadius = SPARO_ICON_EMPHASIS_DEFAULT_CORNER_RADIUS,
  strokeWidth = SPARO_ICON_DEFAULT_STROKE_WIDTH,
  absoluteStrokeWidth = false,
  title,
  className,
  style,
  'aria-label': ariaLabel,
  ...svgProps
}, ref) => {
  const titleId = useId();
  const isLabelled = Boolean(title || ariaLabel);
  const numericSize = typeof size === 'number' ? size : null;
  const resolvedStrokeWidth = absoluteStrokeWidth && numericSize
    ? strokeWidth * (SPARO_ICON_VIEWBOX_SIZE / numericSize)
    : strokeWidth;
  const emphasisStrokeWidth = resolvedStrokeWidth / SPARO_ICON_EMPHASIS_SCALE;
  const detailStrokeWidth = (
    variant === 'emphasis' ? emphasisStrokeWidth : resolvedStrokeWidth
  ) * SPARO_ICON_DETAIL_STROKE_RATIO;
  const resolvedBackgroundRadius = Number.isFinite(backgroundRadius)
    ? Math.min(Math.max(backgroundRadius, 0), SPARO_ICON_EMPHASIS_MAX_CORNER_RADIUS)
    : SPARO_ICON_EMPHASIS_DEFAULT_CORNER_RADIUS;
  const glyphMarkup = systemIconGlyphMarkup[name];

  return (
    <svg
      {...svgProps}
      ref={ref}
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${SPARO_ICON_VIEWBOX_SIZE} ${SPARO_ICON_VIEWBOX_SIZE}`}
      fill="none"
      focusable="false"
      role={isLabelled ? 'img' : undefined}
      aria-hidden={isLabelled ? undefined : true}
      aria-label={ariaLabel}
      aria-labelledby={!ariaLabel && title ? titleId : undefined}
      data-sparo-icon={name}
      data-sparo-variant={variant}
      style={{
        display: 'block',
        flexShrink: 0,
        '--sparo-icon-detail-stroke-width': detailStrokeWidth,
        ...style,
      } as CSSProperties}
    >
      {title ? <title id={titleId}>{title}</title> : null}
      {variant === 'emphasis' ? (
        <>
          {backgroundShape === 'circle' ? (
            <circle
              cx={SPARO_ICON_VIEWBOX_SIZE / 2}
              cy={SPARO_ICON_VIEWBOX_SIZE / 2}
              r={SPARO_ICON_EMPHASIS_RADIUS}
              fill={backgroundColor}
            />
          ) : (
            <rect
              x={SPARO_ICON_EMPHASIS_BACKGROUND_INSET}
              y={SPARO_ICON_EMPHASIS_BACKGROUND_INSET}
              width={SPARO_ICON_VIEWBOX_SIZE - SPARO_ICON_EMPHASIS_BACKGROUND_INSET * 2}
              height={SPARO_ICON_VIEWBOX_SIZE - SPARO_ICON_EMPHASIS_BACKGROUND_INSET * 2}
              rx={resolvedBackgroundRadius}
              fill={backgroundColor}
            />
          )}
          <g
            transform={`translate(${SPARO_ICON_EMPHASIS_TRANSLATE} ${SPARO_ICON_EMPHASIS_TRANSLATE}) scale(${SPARO_ICON_EMPHASIS_SCALE})`}
            stroke={color}
            strokeWidth={emphasisStrokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            dangerouslySetInnerHTML={{ __html: glyphMarkup }}
          />
        </>
      ) : (
        <g
          stroke={color}
          strokeWidth={resolvedStrokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          dangerouslySetInnerHTML={{ __html: glyphMarkup }}
        />
      )}
    </svg>
  );
});

SparoSystemIcon.displayName = 'SparoSystemIcon';
