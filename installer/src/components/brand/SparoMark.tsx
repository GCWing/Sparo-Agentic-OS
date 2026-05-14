import logoMark from '../../assets/sparo-logo-mark.png';

interface SparoMarkProps {
  size?: number;
  wordmark?: boolean;
  /** Use light wordmark text for dark backgrounds. The logo mark itself is theme-neutral. */
  dark?: boolean;
  /** Kept for call-site compatibility; the current logo is a single static mark. */
  animate?: boolean;
}

/**
 * Sparo brand mark using the theme-neutral logo asset.
 */
export function SparoMark({ size = 56, wordmark = false, dark = false, animate = false }: SparoMarkProps) {
  const inkColor = dark ? '#FFFFFF' : '#0F172A';
  void animate;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: wordmark ? 14 : 0 }}>
      <img
        src={logoMark}
        alt="Sparo OS"
        width={size}
        style={{ display: 'block', flexShrink: 0, height: 'auto' }}
        draggable={false}
      />
      {wordmark && (
        <span
          style={{
            fontFamily: "'Inter','Geist','Noto Sans SC',sans-serif",
            fontSize: Math.round(size * 0.52),
            fontWeight: 700,
            color: inkColor,
            letterSpacing: '-0.03em',
            lineHeight: 1,
          }}
        >
          Sparo
        </span>
      )}
    </div>
  );
}
