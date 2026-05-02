import React from 'react';

interface OrbitMarkProps {
  size?: 'sm' | 'md' | 'hero';
  className?: string;
}

const SIZES = {
  sm: 24,
  md: 36,
  hero: 80,
};

const OrbitMark: React.FC<OrbitMarkProps> = ({ size = 'md', className }) => {
  const px = SIZES[size];

  return (
    <svg
      width={px}
      height={px}
      viewBox="-60 -60 120 120"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Concentric circles */}
      <circle cx="0" cy="0" r="20" stroke="rgba(15,23,42,0.18)" strokeWidth="1" />
      <circle cx="0" cy="0" r="35" stroke="rgba(15,23,42,0.14)" strokeWidth="1" />
      <circle cx="0" cy="0" r="50" stroke="rgba(15,23,42,0.10)" strokeWidth="1" />

      {/* Off-axis arc at -18° — the signature red echo arc */}
      <path
        d="M -30 -40 Q 10 -55 45 -20"
        stroke="#B7372F"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.80"
      />

      {/* Ignition node at center */}
      <circle cx="0" cy="0" r="6" fill="#B7372F" />
      <circle cx="0" cy="0" r="12" stroke="#B7372F" strokeWidth="1" strokeOpacity="0.25" />

      {/* Satellite nodes */}
      <circle cx="38" cy="12" r="3" fill="#0F172A" opacity="0.5" />
      <circle cx="-28" cy="38" r="2" fill="#0F172A" opacity="0.4" />
    </svg>
  );
};

export default OrbitMark;
