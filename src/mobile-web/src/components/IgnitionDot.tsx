import React from 'react';
import './IgnitionDot.scss';

interface IgnitionDotProps {
  pulsing?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

const IgnitionDot: React.FC<IgnitionDotProps> = ({ pulsing = false, size = 'md', className }) => (
  <span
    className={[
      'ignition-dot',
      `ignition-dot--${size}`,
      pulsing && 'ignition-dot--pulsing',
      className,
    ].filter(Boolean).join(' ')}
    aria-hidden="true"
  />
);

export default IgnitionDot;
