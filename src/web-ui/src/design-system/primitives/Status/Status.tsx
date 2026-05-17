import React, { forwardRef } from 'react';
import './Status.scss';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'error' | 'accent';
export type StatusSize = 'small' | 'medium';

export interface StatusDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
  size?: StatusSize;
  label?: string;
  pulse?: boolean;
}

export const StatusDot = forwardRef<HTMLSpanElement, StatusDotProps>(
  ({ tone = 'neutral', size = 'medium', label, pulse = false, className = '', ...props }, ref) => (
    <span
      ref={ref}
      className={[
        'ds-status-dot',
        `ds-status-dot--${tone}`,
        `ds-status-dot--${size}`,
        pulse && 'ds-status-dot--pulse',
        className,
      ].filter(Boolean).join(' ')}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      {...props}
    />
  )
);

StatusDot.displayName = 'StatusDot';

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
  size?: StatusSize;
  leadingDot?: boolean;
}

export const StatusPill = forwardRef<HTMLSpanElement, StatusPillProps>(
  ({ tone = 'neutral', size = 'medium', leadingDot = true, children, className = '', ...props }, ref) => (
    <span
      ref={ref}
      className={[
        'ds-status-pill',
        `ds-status-pill--${tone}`,
        `ds-status-pill--${size}`,
        className,
      ].filter(Boolean).join(' ')}
      {...props}
    >
      {leadingDot && <StatusDot tone={tone} size="small" />}
      <span className="ds-status-pill__label">{children}</span>
    </span>
  )
);

StatusPill.displayName = 'StatusPill';
