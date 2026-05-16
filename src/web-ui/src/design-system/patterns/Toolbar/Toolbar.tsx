import React, { forwardRef } from 'react';
import './Toolbar.scss';

export interface ToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  density?: 'compact' | 'normal';
}

export const Toolbar = forwardRef<HTMLDivElement, ToolbarProps>(
  ({ children, density = 'normal', className = '', ...props }, ref) => (
    <div ref={ref} className={['ds-toolbar', `ds-toolbar--${density}`, className].filter(Boolean).join(' ')} {...props}>
      {children}
    </div>
  )
);

Toolbar.displayName = 'Toolbar';

export interface ToolbarGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: 'start' | 'end';
}

export const ToolbarGroup = forwardRef<HTMLDivElement, ToolbarGroupProps>(
  ({ children, align = 'start', className = '', ...props }, ref) => (
    <div ref={ref} className={['ds-toolbar-group', `ds-toolbar-group--${align}`, className].filter(Boolean).join(' ')} {...props}>
      {children}
    </div>
  )
);

ToolbarGroup.displayName = 'ToolbarGroup';
