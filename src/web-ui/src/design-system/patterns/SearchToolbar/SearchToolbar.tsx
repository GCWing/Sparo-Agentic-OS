import React, { forwardRef } from 'react';
import { Search, type SearchProps } from '@/design-system/primitives/Search';
import { Toolbar, ToolbarGroup, type ToolbarProps } from '../Toolbar';
import './SearchToolbar.scss';

export interface SearchToolbarProps extends Omit<ToolbarProps, 'children'> {
  search: SearchProps;
  filters?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

export const SearchToolbar = forwardRef<HTMLDivElement, SearchToolbarProps>(
  ({ search, filters, actions, children, className = '', ...props }, ref) => (
    <Toolbar ref={ref} className={['ds-search-toolbar', className].filter(Boolean).join(' ')} {...props}>
      <ToolbarGroup className="ds-search-toolbar__query">
        <Search {...search} className={['ds-search-toolbar__search', search.className].filter(Boolean).join(' ')} />
        {filters}
        {children}
      </ToolbarGroup>
      {actions && <ToolbarGroup align="end">{actions}</ToolbarGroup>}
    </Toolbar>
  )
);

SearchToolbar.displayName = 'SearchToolbar';
