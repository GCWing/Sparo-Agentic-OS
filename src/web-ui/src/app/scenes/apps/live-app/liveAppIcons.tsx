import React from 'react';

interface LiveAppGlyphProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function LiveAppGlyph({
  size = 28,
  strokeWidth = 1.5,
  className,
}: LiveAppGlyphProps): React.ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="2.35" fill="currentColor" stroke="none" />
      <path d="M12 4.75a7.25 7.25 0 1 1-5.9 3.05" />
      <path d="M6.1 5.8 4.75 7.2" />
    </svg>
  );
}
