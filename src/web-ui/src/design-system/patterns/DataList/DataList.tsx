import React, { forwardRef } from 'react';
import './DataList.scss';

export const DataList = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ children, className = '', role = 'list', ...props }, ref) => (
    <div ref={ref} className={['ds-data-list', className].filter(Boolean).join(' ')} role={role} {...props}>
      {children}
    </div>
  )
);

DataList.displayName = 'DataList';

export interface DataListItemProps extends React.HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
  interactive?: boolean;
}

export const DataListItem = forwardRef<HTMLDivElement, DataListItemProps>(
  ({ children, selected = false, interactive, className = '', onClick, onKeyDown, role, tabIndex, ...props }, ref) => {
    const isInteractive = interactive ?? Boolean(onClick);

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented || !isInteractive) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.currentTarget.click();
      }
    };

    return (
      <div
        ref={ref}
        className={[
          'ds-data-list-item',
          selected && 'ds-data-list-item--selected',
          isInteractive && 'ds-data-list-item--interactive',
          className,
        ].filter(Boolean).join(' ')}
        role={role ?? (isInteractive ? 'button' : 'listitem')}
        tabIndex={tabIndex ?? (isInteractive ? 0 : undefined)}
        aria-selected={selected || undefined}
        onClick={onClick}
        onKeyDown={handleKeyDown}
        {...props}
      >
        {children}
      </div>
    );
  }
);

DataListItem.displayName = 'DataListItem';

export const DataListEmpty = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ children, className = '', ...props }, ref) => (
    <div ref={ref} className={['ds-data-list-empty', className].filter(Boolean).join(' ')} {...props}>
      {children}
    </div>
  )
);

DataListEmpty.displayName = 'DataListEmpty';
