import React, { forwardRef } from 'react';
import { Toolbar, ToolbarGroup, type ToolbarProps } from '../Toolbar';
import './CommandBar.scss';

export interface CommandBarProps extends Omit<ToolbarProps, 'children'> {
  primary?: React.ReactNode;
  secondary?: React.ReactNode;
  meta?: React.ReactNode;
  children?: React.ReactNode;
}

export const CommandBar = forwardRef<HTMLDivElement, CommandBarProps>(
  ({ primary, secondary, meta, children, className = '', ...props }, ref) => (
    <Toolbar ref={ref} className={['ds-command-bar', className].filter(Boolean).join(' ')} {...props}>
      <ToolbarGroup>
        {primary}
        {children}
      </ToolbarGroup>
      {(secondary || meta) && (
        <ToolbarGroup align="end">
          {meta && <div className="ds-command-bar__meta">{meta}</div>}
          {secondary}
        </ToolbarGroup>
      )}
    </Toolbar>
  )
);

CommandBar.displayName = 'CommandBar';
