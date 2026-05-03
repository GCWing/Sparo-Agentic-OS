import type { ReactNode } from 'react';

interface EyebrowProps {
  children: ReactNode;
  dark?: boolean;
  style?: React.CSSProperties;
}

/** VI §12.5 eyebrow: red dot + uppercase tracking label */
export function Eyebrow({ children, dark, style }: EyebrowProps) {
  return (
    <div
      className="eyebrow"
      style={{
        color: dark ? 'rgba(255,255,255,0.6)' : undefined,
        ...style,
      }}
    >
      <span className="eyebrow-dot" />
      {children}
    </div>
  );
}
