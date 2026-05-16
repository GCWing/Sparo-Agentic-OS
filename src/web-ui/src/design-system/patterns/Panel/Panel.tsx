import React, { forwardRef } from 'react';
import './Panel.scss';

export interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'elevated' | 'subtle';
}

export const Panel = forwardRef<HTMLDivElement, PanelProps>(
  ({ children, variant = 'default', className = '', ...props }, ref) => (
    <section ref={ref} className={['ds-panel', `ds-panel--${variant}`, className].filter(Boolean).join(' ')} {...props}>
      {children}
    </section>
  )
);

Panel.displayName = 'Panel';

export interface PanelHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

export const PanelHeader = forwardRef<HTMLDivElement, PanelHeaderProps>(
  ({ title, description, actions, children, className = '', ...props }, ref) => (
    <header ref={ref} className={['ds-panel-header', className].filter(Boolean).join(' ')} {...props}>
      <div className="ds-panel-header__copy">
        {title && <h2 className="ds-panel-header__title">{title}</h2>}
        {description && <p className="ds-panel-header__description">{description}</p>}
        {children}
      </div>
      {actions && <div className="ds-panel-header__actions">{actions}</div>}
    </header>
  )
);

PanelHeader.displayName = 'PanelHeader';

export const PanelBody = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ children, className = '', ...props }, ref) => (
    <div ref={ref} className={['ds-panel-body', className].filter(Boolean).join(' ')} {...props}>
      {children}
    </div>
  )
);

PanelBody.displayName = 'PanelBody';

export const PanelFooter = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ children, className = '', ...props }, ref) => (
    <footer ref={ref} className={['ds-panel-footer', className].filter(Boolean).join(' ')} {...props}>
      {children}
    </footer>
  )
);

PanelFooter.displayName = 'PanelFooter';
