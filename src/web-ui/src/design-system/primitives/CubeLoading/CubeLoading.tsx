import React from 'react';
import './CubeLoading.scss';

export type CubeLoadingSize = 'small' | 'medium' | 'large';

export interface CubeLoadingProps {
  /** Size: small(24px) | medium(40px) | large(60px) */
  size?: CubeLoadingSize;
  /** Loading text */
  text?: string;
  /** Custom class name */
  className?: string;
}

const sizeMap: Record<CubeLoadingSize, string> = {
  small: '24px',
  medium: '40px',
  large: '60px',
};

export const CubeLoading: React.FC<CubeLoadingProps> = ({
  size = 'medium',
  text,
  className = '',
}) => {
  return (
    <div
      className={`cube-loading cube-loading--${size} ${className}`}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}
    >
      <div
        className="cube-loading__matrix"
        style={{
          '--cube-loading-size': sizeMap[size],
        } as React.CSSProperties}
        aria-hidden="true"
      >
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className="cube-loading__dot" />
        ))}
      </div>
      {text && <div className="cube-loading__text">{text}</div>}
    </div>
  );
};

CubeLoading.displayName = 'CubeLoading';

export default CubeLoading;
