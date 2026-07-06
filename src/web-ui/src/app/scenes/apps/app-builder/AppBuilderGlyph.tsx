import React from 'react';

interface AppBuilderGlyphProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function AppBuilderGlyph({
  size = 28,
  strokeWidth = 1.5,
  className,
}: AppBuilderGlyphProps): React.ReactNode {
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
      <path d="M8.2 4.9h7.6a3.3 3.3 0 0 1 3.3 3.3v7.6a3.3 3.3 0 0 1-3.3 3.3H8.2a3.3 3.3 0 0 1-3.3-3.3V8.2a3.3 3.3 0 0 1 3.3-3.3Z" />
      <path d="M8.15 14.1 14.1 8.15" opacity=".72" />
      <path d="M9.4 9.35h5.2a2 2 0 0 1 2 2v5.2" />
      <path d="M13.15 16.55h3.4v-3.4" />
    </svg>
  );
}
