import React from 'react';
import './EmptyState.scss';

export interface EmptyStateProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  image?: React.ReactNode;
  imageSize?: 'small' | 'medium' | 'large' | number;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const DefaultImage: React.FC<{ size: number }> = ({ size }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 120 120"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle cx="60" cy="60" r="50" fill="rgba(96, 165, 250, 0.1)" />
    <path
      d="M40 50C40 44.4772 44.4772 40 50 40H70C75.5228 40 80 44.4772 80 50V70C80 75.5228 75.5228 80 70 80H50C44.4772 80 40 75.5228 40 70V50Z"
      fill="rgba(96, 165, 250, 0.2)"
    />
    <circle cx="52" cy="55" r="4" fill="rgba(96, 165, 250, 0.4)" />
    <circle cx="68" cy="55" r="4" fill="rgba(96, 165, 250, 0.4)" />
    <path
      d="M52 68C52 65.7909 53.7909 64 56 64H64C66.2091 64 68 65.7909 68 68"
      stroke="rgba(96, 165, 250, 0.4)"
      strokeWidth="3"
      strokeLinecap="round"
    />
  </svg>
);

function getImageSize(imageSize: EmptyStateProps['imageSize']): number {
  if (typeof imageSize === 'number') return imageSize;
  const sizes = { small: 80, medium: 120, large: 160 };
  return sizes[imageSize ?? 'medium'];
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  actions,
  image,
  imageSize = 'medium',
  children,
  className = '',
  style,
}) => {
  const size = getImageSize(imageSize);
  const resolvedDescription = description ?? (title ? undefined : 'No data');

  return (
    <div className={['ds-empty-state', className].filter(Boolean).join(' ')} style={style}>
      <div className="ds-empty-state__image">{image || <DefaultImage size={size} />}</div>
      {(title || resolvedDescription) && (
        <div className="ds-empty-state__description">
          {title && <strong>{title}</strong>}
          {resolvedDescription && <span>{resolvedDescription}</span>}
        </div>
      )}
      {(actions || children) && (
        <div className="ds-empty-state__footer">{actions ?? children}</div>
      )}
    </div>
  );
};

EmptyState.displayName = 'EmptyState';
