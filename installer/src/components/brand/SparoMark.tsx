import mark16 from '../../assets/brand/sparo-mark-16.png';
import mark24 from '../../assets/brand/sparo-mark-24.png';
import mark32 from '../../assets/brand/sparo-mark-32.png';
import mark48 from '../../assets/brand/sparo-mark-48.png';
import markFull from '../../assets/brand/sparo-mark-full.png';

interface SparoMarkProps {
  size?: number;
}

function sourceForSize(size: number) {
  if (size <= 20) return mark16;
  if (size <= 28) return mark24;
  if (size <= 40) return mark32;
  if (size < 64) return mark48;
  return markFull;
}

/** Uses the declared responsive brand source for the requested display size. */
export function SparoMark({ size = 56 }: SparoMarkProps) {
  return (
    <img
      src={sourceForSize(size)}
      alt="Sparo OS"
      width={size}
      height={size}
      draggable={false}
      style={{ display: 'block', flexShrink: 0 }}
    />
  );
}
