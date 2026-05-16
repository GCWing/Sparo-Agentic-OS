import React, { forwardRef } from 'react';
import './StatusBar.scss';

export interface StatusBarProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
}

export const StatusBar = forwardRef<HTMLDivElement, StatusBarProps>(
  ({ tone = 'neutral', leading, trailing, children, className = '', ...props }, ref) => (
    <div
      ref={ref}
      className={['ds-status-bar', `ds-status-bar--${tone}`, className].filter(Boolean).join(' ')}
      {...props}
    >
      {leading && <span className="ds-status-bar__leading">{leading}</span>}
      <div className="ds-status-bar__content">{children}</div>
      {trailing && <span className="ds-status-bar__trailing">{trailing}</span>}
    </div>
  )
);

StatusBar.displayName = 'StatusBar';
