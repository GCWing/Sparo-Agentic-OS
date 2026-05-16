import React, { forwardRef } from 'react';
import './ToolCard.scss';

export interface ToolCardProps extends React.HTMLAttributes<HTMLDivElement> {
  status?: 'pending' | 'running' | 'completed' | 'error';
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'ai';
}

export const ToolCard = forwardRef<HTMLDivElement, ToolCardProps>(
  ({ children, status = 'pending', tone = 'neutral', className = '', ...props }, ref) => (
    <article
      ref={ref}
      className={['ds-tool-card', `ds-tool-card--${status}`, `ds-tool-card--${tone}`, className].filter(Boolean).join(' ')}
      {...props}
    >
      {children}
    </article>
  )
);

ToolCard.displayName = 'ToolCard';

export interface ToolCardHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}

export const ToolCardHeader = forwardRef<HTMLDivElement, ToolCardHeaderProps>(
  ({ icon, title, meta, actions, className = '', ...props }, ref) => (
    <header ref={ref} className={['ds-tool-card-header', className].filter(Boolean).join(' ')} {...props}>
      {icon && <div className="ds-tool-card-header__icon">{icon}</div>}
      <div className="ds-tool-card-header__copy">
        <div className="ds-tool-card-header__title">{title}</div>
        {meta && <div className="ds-tool-card-header__meta">{meta}</div>}
      </div>
      {actions && <div className="ds-tool-card-header__actions">{actions}</div>}
    </header>
  )
);

ToolCardHeader.displayName = 'ToolCardHeader';

export const ToolCardBody = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ children, className = '', ...props }, ref) => (
    <div ref={ref} className={['ds-tool-card-body', className].filter(Boolean).join(' ')} {...props}>
      {children}
    </div>
  )
);

ToolCardBody.displayName = 'ToolCardBody';

export const ToolCardFooter = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ children, className = '', ...props }, ref) => (
    <footer ref={ref} className={['ds-tool-card-footer', className].filter(Boolean).join(' ')} {...props}>
      {children}
    </footer>
  )
);

ToolCardFooter.displayName = 'ToolCardFooter';

export interface ToolCardShellProps extends Omit<ToolCardProps, 'title'> {
  icon?: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
}

export const ToolCardShell = forwardRef<HTMLDivElement, ToolCardShellProps>(
  ({ icon, title, meta, actions, footer, children, ...props }, ref) => (
    <ToolCard ref={ref} {...props}>
      <ToolCardHeader icon={icon} title={title} meta={meta} actions={actions} />
      {children && <ToolCardBody>{children}</ToolCardBody>}
      {footer && <ToolCardFooter>{footer}</ToolCardFooter>}
    </ToolCard>
  )
);

ToolCardShell.displayName = 'ToolCardShell';
