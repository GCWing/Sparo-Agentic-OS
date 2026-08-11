import { forwardRef, type ImgHTMLAttributes } from 'react';

import mark16 from '../brand/sparo-mark-16.png';
import mark24 from '../brand/sparo-mark-24.png';
import mark32 from '../brand/sparo-mark-32.png';
import mark48 from '../brand/sparo-mark-48.png';
import markFull from '../brand/sparo-mark-full.png';

export interface SparoLogoMarkProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'height' | 'src' | 'width'> {
  /** Selects the matching responsive source instead of scaling one small mark across sizes. */
  size?: number | string;
}

function sourceForSize(size: number | string) {
  if (typeof size !== 'number') return markFull;
  if (size <= 20) return mark16;
  if (size <= 28) return mark24;
  if (size <= 40) return mark32;
  if (size < 64) return mark48;
  return markFull;
}

export const SparoLogoMark = forwardRef<HTMLImageElement, SparoLogoMarkProps>(({
  size = 24,
  alt = '',
  draggable = false,
  ...props
}, ref) => (
  <img
    ref={ref}
    src={sourceForSize(size)}
    width={size}
    height={size}
    alt={alt}
    draggable={draggable}
    {...props}
  />
));

SparoLogoMark.displayName = 'SparoLogoMark';
