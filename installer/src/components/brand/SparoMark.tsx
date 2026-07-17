import logoMark from '../../assets/sparo-logo-mark.png';

interface SparoMarkProps {
  size?: number;
}

/**
 * Sparo brand mark using the theme-neutral logo asset.
 */
export function SparoMark({ size = 56 }: SparoMarkProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <img
        src={logoMark}
        alt="Sparo OS"
        width={size}
        style={{ display: 'block', flexShrink: 0, height: 'auto' }}
        draggable={false}
      />
    </div>
  );
}
