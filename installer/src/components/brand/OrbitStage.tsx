import { useEffect, useRef, useState } from 'react';

export type OrbitPhase = 'idle' | 'place' | 'igniting' | 'ignited' | 'farewell';

interface OrbitStageProps {
  phase: OrbitPhase;
  /** 0 = none lit, 1-4 = satellite index lit */
  activeSatellite?: number;
  /** Number of live providers (for model setup) */
  liveProviders?: number;
  /** Dark mode for Act 4 */
  dark?: boolean;
  size?: 'full' | 'compact';
}

// Satellite positions (on different orbit radii, off-symmetry per VI §12.2)
const SATELLITES = [
  { cx: 140, cy: -200, r: 5 },
  { cx: -260, cy: 120, r: 5 },
  { cx: 300, cy: 220, r: 5 },
  { cx: -150, cy: 300, r: 5 },
];

export function OrbitStage({ phase, activeSatellite = 0, dark = false, size = 'full' }: OrbitStageProps) {
  const nodeRef = useRef<SVGCircleElement | null>(null);
  const trackRef = useRef<SVGGElement | null>(null);
  const [ignited, setIgnited] = useState(false);
  const [flashTrack, setFlashTrack] = useState(false);

  useEffect(() => {
    if (phase === 'ignited' && !ignited) {
      setIgnited(true);
      setFlashTrack(true);
      setTimeout(() => setFlashTrack(false), 700);
    }
    if (phase === 'farewell') {
      setIgnited(false);
    }
  }, [phase, ignited]);

  const strokeBase = dark
    ? 'rgba(255,255,255,0.12)'
    : 'rgba(15,23,42,0.14)';
  const strokeDash = dark
    ? 'rgba(255,255,255,0.08)'
    : 'rgba(15,23,42,0.10)';
  const strokeAxis = dark
    ? 'rgba(255,255,255,0.20)'
    : 'rgba(15,23,42,0.22)';
  const redArc = phase === 'ignited' || flashTrack ? 'rgba(183,55,47,0.75)' : '#B7372F';
  const trackOpacity = flashTrack ? 0.7 : 0.55;

  const nodeColor = phase === 'idle' || phase === 'place'
    ? (dark ? 'rgba(255,255,255,0.3)' : '#5B6B8C')
    : '#B7372F';

  const nodeRadius = phase === 'igniting' ? 8 : 7;

  // Determine which satellites are lit
  const satIsLit = (idx: number) => {
    if (phase === 'farewell') {
      // Reverse: idx >= activeSatellite means unlit
      return idx < activeSatellite;
    }
    return idx < activeSatellite;
  };

  const breathingAnim = phase === 'igniting'
    ? 'nodeBreath 1.8s ease-in-out infinite'
    : ignited
    ? 'ignitionPulse 2.2s ease-out 1'
    : 'none';

  const orbitContainerStyle = size === 'compact'
    ? { position: 'absolute' as const, inset: 0, opacity: 0.7 }
    : { position: 'absolute' as const, inset: 0, opacity: trackOpacity };

  // For compact (Act 4 dark CTA), only 3 circles + 1 arc + 1 node
  if (size === 'compact') {
    return (
      <div style={orbitContainerStyle}>
        <svg
          width="100%" height="100%"
          viewBox="-400 -400 800 800"
          style={{ pointerEvents: 'none' }}
          aria-hidden="true"
        >
          <circle cx="0" cy="0" r="120" fill="none" stroke={strokeBase} strokeWidth="1" />
          <circle cx="0" cy="0" r="220" fill="none" stroke={strokeBase} strokeWidth="1" />
          <circle cx="0" cy="0" r="340" fill="none" stroke={strokeBase} strokeWidth="1" />
          {/* echo arc */}
          <path
            d="M -200 -100 A 220 220 0 0 1 100 -200"
            fill="none"
            stroke="#E06B5F"
            strokeWidth="3"
            strokeLinecap="round"
          />
          {/* ignition node */}
          <circle cx="0" cy="0" r="7" fill="#B7372F" />
          <circle cx="0" cy="0" r="14" fill="none" stroke="#B7372F" strokeWidth="1" opacity="0.25" />
        </svg>
      </div>
    );
  }

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <svg
        ref={trackRef as any}
        width="100%" height="100%"
        viewBox="-600 -600 1200 1200"
        style={{
          position: 'absolute', inset: 0,
          opacity: trackOpacity,
          pointerEvents: 'none',
          transition: 'opacity 0.6s ease',
          animation: 'orbitSpinSlow 40s linear infinite',
          transformOrigin: 'center',
        }}
        aria-hidden="true"
      >
        {/* 5 solid concentric circles */}
        <circle cx="0" cy="0" r="120" fill="none" stroke={strokeBase} strokeWidth="1" />
        <circle cx="0" cy="0" r="200" fill="none" stroke={strokeBase} strokeWidth="1" />
        <circle cx="0" cy="0" r="300" fill="none" stroke={strokeBase} strokeWidth="1" />
        <circle cx="0" cy="0" r="420" fill="none" stroke={strokeBase} strokeWidth="1" />
        <circle cx="0" cy="0" r="560" fill="none" stroke={strokeBase} strokeWidth="1" />

        {/* 4 dashed circles */}
        <circle cx="0" cy="0" r="160" fill="none" stroke={strokeDash} strokeWidth="1" strokeDasharray="2 6" />
        <circle cx="0" cy="0" r="260" fill="none" stroke={strokeDash} strokeWidth="1" strokeDasharray="2 6" />
        <circle cx="0" cy="0" r="360" fill="none" stroke={strokeDash} strokeWidth="1" strokeDasharray="2 6" />
        <circle cx="0" cy="0" r="480" fill="none" stroke={strokeDash} strokeWidth="1" strokeDasharray="2 6" />
      </svg>

      {/* Static overlays (not spinning) */}
      <svg
        width="100%" height="100%"
        viewBox="-600 -600 1200 1200"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: trackOpacity }}
        aria-hidden="true"
      >
        {/* 2 off-axis arcs at -18° (VI §12.2) */}
        <g transform="rotate(-18)">
          <path d="M -560 0 A 560 560 0 0 1 0 -560" fill="none" stroke={strokeAxis} strokeWidth="1.5" />
          <path d="M 300 0 A 300 300 0 0 1 0 300" fill="none" stroke={strokeAxis} strokeWidth="1.5" />
        </g>

        {/* One red arc — only one per composition (VI §12.2) */}
        <path
          d="M -280 -200 A 340 340 0 0 1 160 -300"
          fill="none"
          stroke={redArc}
          strokeWidth="3"
          strokeLinecap="round"
          opacity={ignited ? 0.85 : 0.75}
          style={{ transition: 'opacity 0.6s ease, stroke 0.6s ease' }}
        />

        {/* Satellite nodes (progress indicators) */}
        {SATELLITES.map((sat, i) => {
          const lit = satIsLit(i + 1);
          return (
            <g key={i}>
              <circle
                cx={sat.cx} cy={sat.cy} r={lit ? 6 : sat.r}
                fill={lit ? '#B7372F' : (dark ? 'rgba(255,255,255,0.5)' : '#0F172A')}
                opacity={lit ? 0.9 : 0.5}
                style={{
                  transition: 'fill 0.4s ease, r 0.4s ease, opacity 0.4s ease',
                  animation: lit ? 'orbitPulse 2.4s ease-in-out infinite' : 'none',
                  transformOrigin: `${sat.cx}px ${sat.cy}px`,
                }}
              />
              {lit && (
                <circle
                  cx={sat.cx} cy={sat.cy} r={12}
                  fill="none" stroke="#B7372F" strokeWidth="1" opacity="0.2"
                />
              )}
            </g>
          );
        })}

        {/* Center ignition node */}
        <circle
          ref={nodeRef}
          cx="0" cy="0"
          r={nodeRadius}
          fill={nodeColor}
          style={{
            transition: 'fill 0.6s ease, r 0.4s ease',
            animation: breathingAnim,
            transformOrigin: 'center',
          }}
        />
        <circle
          cx="0" cy="0" r="16"
          fill="none"
          stroke={nodeColor}
          strokeWidth="1"
          opacity="0.25"
          style={{ transition: 'stroke 0.6s ease' }}
        />
      </svg>
    </div>
  );
}
