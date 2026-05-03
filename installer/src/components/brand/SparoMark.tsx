import { useEffect, useRef, useState } from 'react';
// logo-light-transparent: light-colored logo, for light (cloud) backgrounds
import logoForLightBg from '../../assets/logo-light-transparent.png';
// logo-dark-transparent: dark-colored logo, for dark (ink) backgrounds
import logoForDarkBg from '../../assets/logo-dark-transparent.png';

// 8-frame logo animation sequence (dark-transparent frames)
import frame01 from '../../assets/logo-animation/logo-frame-01.png';
import frame02 from '../../assets/logo-animation/logo-frame-02.png';
import frame03 from '../../assets/logo-animation/logo-frame-03.png';
import frame04 from '../../assets/logo-animation/logo-frame-04.png';
import frame05 from '../../assets/logo-animation/logo-frame-05.png';
import frame06 from '../../assets/logo-animation/logo-frame-06.png';
import frame07 from '../../assets/logo-animation/logo-frame-07.png';
import frame08 from '../../assets/logo-animation/logo-frame-08.png';

const FRAMES = [frame01, frame02, frame03, frame04, frame05, frame06, frame07, frame08];
const FRAME_MS = 80; // ~12.5 fps — full cycle ≈ 640ms

interface SparoMarkProps {
  size?: number;
  wordmark?: boolean;
  /** Use light logo (for dark backgrounds, e.g. Act 4 Dark CTA) */
  dark?: boolean;
  /** Play the 8-frame intro animation once on mount, then hold static logo */
  animate?: boolean;
}

/**
 * Sparo brand mark using official logo assets.
 * dark=false  → logo-dark-transparent (for light/cloud backgrounds)
 * dark=true   → logo-light-transparent (for ink/dark backgrounds)
 */
export function SparoMark({ size = 56, wordmark = false, dark = false, animate = false }: SparoMarkProps) {
  const inkColor = dark ? '#FFFFFF' : '#0F172A';
  // dark=false → light background → use light-transparent logo
  // dark=true  → dark/ink background → use dark-transparent logo
  const staticSrc = dark ? logoForDarkBg : logoForLightBg;
  const [frameIdx, setFrameIdx] = useState(animate ? 0 : -1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!animate) return;
    let idx = 0;
    const tick = () => {
      idx += 1;
      if (idx < FRAMES.length) {
        setFrameIdx(idx);
        timerRef.current = setTimeout(tick, FRAME_MS);
      } else {
        setFrameIdx(-1); // animation done — show static logo
      }
    };
    timerRef.current = setTimeout(tick, FRAME_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [animate]);

  const src = frameIdx >= 0 ? FRAMES[frameIdx] : staticSrc;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: wordmark ? 14 : 0 }}>
      <img
        src={src}
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
