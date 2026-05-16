import React from 'react';
import './Spiral.scss';

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
        className="panda-breath-container"
        style={{
          '--uib-size': sizeMap[size],
          '--uib-color': 'currentColor',
          '--uib-speed': '0.9s',
        } as React.CSSProperties}
      >
        <div className="panda-face" />
        <div className="panda-eye panda-eye--left" />
        <div className="panda-eye panda-eye--right" />
      </div>
      {text && <div className="cube-loading__text">{text}</div>}
    </div>
  );
};

CubeLoading.displayName = 'CubeLoading';

export default CubeLoading;
