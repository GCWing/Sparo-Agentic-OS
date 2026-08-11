import { forwardRef, type ImgHTMLAttributes } from 'react';

import core16 from '../brand/sparo-core-16.png';
import core20 from '../brand/sparo-core-20.png';
import core24 from '../brand/sparo-core-24.png';
import core32 from '../brand/sparo-core-32.png';
import core48 from '../brand/sparo-core-48.png';

export type SparoLogoCoreSize = 16 | 20 | 24 | 32 | 48;

export interface SparoLogoCoreProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'height' | 'src' | 'width'> {
  /** Uses the matching target-size core shared with the default tray icon. */
  size?: SparoLogoCoreSize;
  /** Uses a larger raster source when the rendered surface needs high-DPI clarity. */
  sourceSize?: SparoLogoCoreSize;
}

const sources: Record<SparoLogoCoreSize, string> = {
  16: core16,
  20: core20,
  24: core24,
  32: core32,
  48: core48,
};

export const SparoLogoCore = forwardRef<HTMLImageElement, SparoLogoCoreProps>(({
  size = 24,
  sourceSize = size,
  alt = '',
  draggable = false,
  ...props
}, ref) => (
  <img
    ref={ref}
    src={sources[sourceSize]}
    width={size}
    height={size}
    alt={alt}
    draggable={draggable}
    {...props}
  />
));

SparoLogoCore.displayName = 'SparoLogoCore';
