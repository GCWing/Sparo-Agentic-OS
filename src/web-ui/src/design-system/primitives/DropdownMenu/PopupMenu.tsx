import React, { forwardRef } from 'react';
import './PopupMenu.scss';

export type PopupMenuPadding = 'none' | 'compact';

export interface PopupMenuProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Content padding. Composite product menus can opt out and manage their own layout. */
  padding?: PopupMenuPadding;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/**
 * Shared visual surface for popup menus.
 *
 * Use DropdownMenu when a simple anchored item menu is sufficient. Use this
 * surface directly for richer menu compositions that need product-owned rows.
 */
export const PopupMenu = forwardRef<HTMLDivElement, PopupMenuProps>(({
  className,
  padding = 'compact',
  role = 'menu',
  ...props
}, ref) => (
  <div
    ref={ref}
    className={cx('ds-popup-menu', `ds-popup-menu--padding-${padding}`, className)}
    role={role}
    {...props}
  />
));

PopupMenu.displayName = 'PopupMenu';
