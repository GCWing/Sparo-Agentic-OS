import type { ImgHTMLAttributes } from 'react';

interface SparoMarkProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'height' | 'src' | 'width'> {
  size: number;
}

function assetNameForSize(size: number) {
  if (size <= 20) return 'sparo-mark-16.png';
  if (size <= 28) return 'sparo-mark-24.png';
  if (size <= 40) return 'sparo-mark-32.png';
  if (size < 64) return 'sparo-mark-48.png';
  return 'sparo-mark-full.png';
}

export function SparoMark({ size, alt = '', draggable = false, ...props }: SparoMarkProps) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}brand/${assetNameForSize(size)}`}
      width={size}
      height={size}
      alt={alt}
      draggable={draggable}
      {...props}
    />
  );
}
