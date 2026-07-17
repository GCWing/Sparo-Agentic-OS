// Satellite positions (on different orbit radii, off-symmetry per VI §12.2)
const SATELLITES = [
  { cx: 140, cy: -200, r: 5 },
  { cx: -260, cy: 120, r: 5 },
  { cx: 300, cy: 220, r: 5 },
  { cx: -150, cy: 300, r: 5 },
];

export function OrbitStage() {
  const strokeBase = 'rgba(15,23,42,0.14)';
  const strokeDash = 'rgba(15,23,42,0.10)';
  const strokeAxis = 'rgba(15,23,42,0.22)';
  const trackOpacity = 0.55;

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <svg
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
          stroke="#B7372F"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.75"
        />

        {/* Satellite nodes */}
        {SATELLITES.map((sat, index) => (
          <circle
            key={index}
            cx={sat.cx}
            cy={sat.cy}
            r={sat.r}
            fill="#0F172A"
            opacity="0.5"
          />
        ))}

        {/* Center ignition node */}
        <circle
          cx="0" cy="0"
          r="7"
          fill="#5B6B8C"
        />
        <circle
          cx="0" cy="0" r="16"
          fill="none"
          stroke="#5B6B8C"
          strokeWidth="1"
          opacity="0.25"
        />
      </svg>
    </div>
  );
}
