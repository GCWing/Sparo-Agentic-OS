import React from 'react';

interface HairlineDividerProps {
  className?: string;
}

const HairlineDivider: React.FC<HairlineDividerProps> = ({ className }) => (
  <div
    className={className}
    style={{ height: '1px', background: 'var(--border-subtle)', flexShrink: 0 }}
    aria-hidden="true"
  />
);

export default HairlineDivider;
