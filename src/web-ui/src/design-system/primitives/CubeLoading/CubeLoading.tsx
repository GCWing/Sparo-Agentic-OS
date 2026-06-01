import React from 'react';
import { DotMatrixLoader, type DotMatrixLoaderSize } from '../Spinner';
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

const matrixSizeMap: Record<CubeLoadingSize, DotMatrixLoaderSize> = {
  small: 'small',
  medium: 'medium',
  large: 'large',
};

export const CubeLoading: React.FC<CubeLoadingProps> = ({
  size = 'medium',
  text,
  className = '',
}) => {
  return (
    <div
      className={`cube-loading cube-loading--${size} ${className}`}
    >
      <DotMatrixLoader size={matrixSizeMap[size]} className="cube-loading__matrix" ariaHidden />
      {text && <div className="cube-loading__text">{text}</div>}
    </div>
  );
};

CubeLoading.displayName = 'CubeLoading';

export default CubeLoading;
