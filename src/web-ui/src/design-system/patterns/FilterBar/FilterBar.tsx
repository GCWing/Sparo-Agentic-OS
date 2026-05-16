import React, { forwardRef } from 'react';
import './FilterBar.scss';

export interface FilterBarProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
  actions?: React.ReactNode;
}

export const FilterBar = forwardRef<HTMLDivElement, FilterBarProps>(
  ({ label, actions, children, className = '', ...props }, ref) => (
    <div ref={ref} className={['ds-filter-bar', className].filter(Boolean).join(' ')} {...props}>
      {label && <div className="ds-filter-bar__label">{label}</div>}
      <div className="ds-filter-bar__items">{children}</div>
      {actions && <div className="ds-filter-bar__actions">{actions}</div>}
    </div>
  )
);

FilterBar.displayName = 'FilterBar';
