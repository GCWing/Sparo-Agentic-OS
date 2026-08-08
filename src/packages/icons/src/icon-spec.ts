export const SPARO_ICON_VIEWBOX_SIZE = 48;
export const SPARO_ICON_LIVE_AREA = 40;
export const SPARO_ICON_SAFE_MARGIN = 4;
export const SPARO_ICON_DEFAULT_SIZE = 64;
export const SPARO_ICON_DEFAULT_STROKE_WIDTH = 2;
export const SPARO_ICON_DETAIL_STROKE_RATIO = 0.7;
export const SPARO_ICON_EMPHASIS_SCALE = 0.78;
export const SPARO_ICON_EMPHASIS_TRANSLATE = 5.28;
export const SPARO_ICON_EMPHASIS_RADIUS = 22;
export const SPARO_ICON_EMPHASIS_BACKGROUND_INSET = 2;
export const SPARO_ICON_EMPHASIS_DEFAULT_CORNER_RADIUS = 10;
export const SPARO_ICON_EMPHASIS_MAX_CORNER_RADIUS = 22;

export type SparoIconBackgroundShape = 'circle' | 'rounded-rect';

export const SPARO_ICON_RENDER_SIZES = [48, 64, 80, 96, 128] as const;

export type SparoIconRenderSize = (typeof SPARO_ICON_RENDER_SIZES)[number];
