import React from 'react';

export type DotMatrixLoaderSize = 'small' | 'medium';

export interface DotMatrixLoaderProps {
  /** small: 4px cells; medium: 6px cells (matches flow chat processing row). */
  size?: DotMatrixLoaderSize;
  className?: string;
  /** Decorative; keeps screen readers from counting 9 spans. @default true */
  ariaHidden?: boolean;
}

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'small' | 'medium';
  label?: string;
  className?: string;
  decorative?: boolean;
}

function mapSize(size: SpinnerProps['size']) {
  return size === 'sm' || size === 'small' ? 'small' : 'medium';
}

const dotMatrixSizeClass: Record<DotMatrixLoaderSize, string> = {
  small: 'dot-matrix-loader--small',
  medium: 'dot-matrix-loader--medium',
};

export const DotMatrixLoader: React.FC<DotMatrixLoaderProps> = ({
  size = 'medium',
  className = '',
  ariaHidden = true,
}) => (
  <span
    className={`dot-matrix-loader ${dotMatrixSizeClass[size]} ${className}`.trim()}
    aria-hidden={ariaHidden}
  >
    {Array.from({ length: 9 }, (_, i) => (
      <span key={i} className="dot-matrix-loader__dot" />
    ))}
  </span>
);

DotMatrixLoader.displayName = 'DotMatrixLoader';

export const Spinner: React.FC<SpinnerProps> = ({
  size = 'md',
  label,
  className = '',
  decorative = false,
}) => (
  <span
    className={['ds-spinner', className].filter(Boolean).join(' ')}
    role={decorative ? undefined : 'status'}
    aria-label={decorative ? undefined : label ?? 'Loading'}
  >
    <DotMatrixLoader size={mapSize(size)} ariaHidden />
    {label && <span className="ds-spinner__label">{label}</span>}
  </span>
);

Spinner.displayName = 'Spinner';

export default DotMatrixLoader;
