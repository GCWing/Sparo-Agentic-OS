import React, { forwardRef } from 'react';
import './NavigationList.scss';

export const NavigationList = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ children, className = '', ...props }, ref) => (
    <nav ref={ref} className={['ds-navigation-list', className].filter(Boolean).join(' ')} {...props}>
      {children}
    </nav>
  )
);

NavigationList.displayName = 'NavigationList';

export interface NavigationListItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  icon?: React.ReactNode;
  meta?: React.ReactNode;
}

export const NavigationListItem = forwardRef<HTMLButtonElement, NavigationListItemProps>(
  ({ active = false, icon, meta, children, className = '', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={['ds-navigation-list-item', active && 'ds-navigation-list-item--active', className]
        .filter(Boolean)
        .join(' ')}
      aria-current={active ? 'page' : undefined}
      {...props}
    >
      {icon && <span className="ds-navigation-list-item__icon">{icon}</span>}
      <span className="ds-navigation-list-item__label">{children}</span>
      {meta && <span className="ds-navigation-list-item__meta">{meta}</span>}
    </button>
  )
);

NavigationListItem.displayName = 'NavigationListItem';
