import React, { forwardRef } from 'react';
import './DetailHeader.scss';

export interface DetailHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  eyebrow?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}

export const DetailHeader = forwardRef<HTMLDivElement, DetailHeaderProps>(
  ({ title, subtitle, eyebrow, meta, actions, className = '', ...props }, ref) => (
    <header ref={ref} className={['ds-detail-header', className].filter(Boolean).join(' ')} {...props}>
      <div className="ds-detail-header__copy">
        {eyebrow && <div className="ds-detail-header__eyebrow">{eyebrow}</div>}
        <h1 className="ds-detail-header__title">{title}</h1>
        {subtitle && <p className="ds-detail-header__subtitle">{subtitle}</p>}
        {meta && <div className="ds-detail-header__meta">{meta}</div>}
      </div>
      {actions && <div className="ds-detail-header__actions">{actions}</div>}
    </header>
  )
);

DetailHeader.displayName = 'DetailHeader';
