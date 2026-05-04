/**
 * LogoFrameAnimation — minimalist VI loader used in flow chat processing state.
 *
 * Design: a hairline ring with a single red dot orbiting it, plus a gently
 * pulsing red core. Pure CSS animation; no image assets required.
 */
import React from 'react';
import './LogoFrameAnimation.scss';

interface LogoFrameAnimationProps {
  size?: number;
  className?: string;
}

export const LogoFrameAnimation: React.FC<LogoFrameAnimationProps> = ({
  size = 28,
  className,
}) => {
  const classNames = ['logo-frame-animation', className].filter(Boolean).join(' ');

  return (
    <span
      className={classNames}
      style={{ '--logo-frame-animation-size': `${size}px` } as React.CSSProperties}
      aria-hidden="true"
    >
      <svg
        className="logo-frame-animation__svg"
        viewBox="0 0 100 100"
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
      >
        {/* Ambient ring */}
        <circle
          className="logo-frame-animation__ring"
          cx="50"
          cy="50"
          r="36"
          fill="none"
        />
        {/* Orbit group rotates clockwise around (50,50) */}
        <g className="logo-frame-animation__orbit">
          <circle className="logo-frame-animation__dot" cx="50" cy="14" r="5" />
        </g>
        {/* Pulsing core */}
        <circle className="logo-frame-animation__core" cx="50" cy="50" r="4" />
      </svg>
    </span>
  );
};
