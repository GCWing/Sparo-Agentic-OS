import React, { forwardRef } from 'react';
import './Skeleton.scss';

export interface SkeletonProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'text' | 'block' | 'circle';
  width?: React.CSSProperties['width'];
  height?: React.CSSProperties['height'];
  animated?: boolean;
}

export const Skeleton = forwardRef<HTMLSpanElement, SkeletonProps>(
  ({ variant = 'block', width, height, animated = true, className = '', style, ...props }, ref) => (
    <span
      ref={ref}
      className={[
        'ds-skeleton',
        `ds-skeleton--${variant}`,
        animated && 'ds-skeleton--animated',
        className,
      ].filter(Boolean).join(' ')}
      style={{ width, height, ...style }}
      aria-hidden="true"
      {...props}
    />
  )
);

Skeleton.displayName = 'Skeleton';

export interface LoadingSkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  lines?: number;
  compact?: boolean;
  avatar?: boolean;
}

export const LoadingSkeleton = forwardRef<HTMLDivElement, LoadingSkeletonProps>(
  ({ lines = 3, compact = false, avatar = false, className = '', ...props }, ref) => (
    <div
      ref={ref}
      className={[
        'ds-loading-skeleton',
        compact && 'ds-loading-skeleton--compact',
        className,
      ].filter(Boolean).join(' ')}
      aria-busy="true"
      aria-label="Loading"
      role="status"
      {...props}
    >
      {avatar && <Skeleton variant="circle" className="ds-loading-skeleton__avatar" />}
      <div className="ds-loading-skeleton__content">
        {Array.from({ length: Math.max(1, lines) }, (_, index) => (
          <Skeleton
            key={index}
            variant="text"
            className="ds-loading-skeleton__line"
            style={{ ['--ds-skeleton-line-scale' as string]: index === lines - 1 ? '72%' : '100%' }}
          />
        ))}
      </div>
    </div>
  )
);

LoadingSkeleton.displayName = 'LoadingSkeleton';
