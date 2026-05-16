import React from 'react';
import { Bookmark, SquareTerminal } from 'lucide-react';
import { Tooltip } from '@/design-system';
import type { MenuItem } from '@/shared/context-menu-system/types/menu.types';
import type { ShellEntry } from '../hooks/shellEntryTypes';

interface QuickAction {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
}

interface ShellNavEntryItemProps {
  entry: ShellEntry;
  isActive: boolean;
  showSavedBadge: boolean;
  startupCommandBadgeLabel: string;
  savedBadgeLabel: string;
  quickAction: QuickAction;
  getEntryMenuItems: (entry: ShellEntry) => MenuItem[];
  onOpen: (entry: ShellEntry) => Promise<void>;
  onOpenContextMenu: (
    event: React.MouseEvent<HTMLElement>,
    items: MenuItem[],
    data: Record<string, unknown>,
  ) => void;
}

const ShellNavEntryItem: React.FC<ShellNavEntryItemProps> = ({
  entry,
  isActive,
  showSavedBadge,
  startupCommandBadgeLabel,
  savedBadgeLabel,
  quickAction,
  getEntryMenuItems,
  onOpen,
  onOpenContextMenu,
}) => {
  return (
    <div
      role="button"
      tabIndex={0}
      className={[
        'bitfun-shell-nav__terminal-item',
        isActive && 'is-active',
      ].filter(Boolean).join(' ')}
      onClick={() => { void onOpen(entry); }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          void onOpen(entry);
        }
      }}
      onContextMenu={(event) => {
        const menuItems = getEntryMenuItems(entry);
        if (menuItems.length === 0) {
          return;
        }

        onOpenContextMenu(event, menuItems, { entry });
      }}
    >
      <Tooltip content={entry.name} placement="right">
        <span className="bitfun-shell-nav__terminal-item-main">
          {showSavedBadge ? (
            <Bookmark size={14} className="bitfun-shell-nav__terminal-icon bitfun-shell-nav__terminal-icon--saved" />
          ) : (
            <SquareTerminal size={14} className="bitfun-shell-nav__terminal-icon" />
          )}

          <span className="bitfun-shell-nav__terminal-label">{entry.name}</span>

          {showSavedBadge ? (
            <span className="bitfun-shell-nav__saved-indicator">{savedBadgeLabel}</span>
          ) : null}

          {entry.startupCommand ? (
            <span className="bitfun-shell-nav__cmd-indicator">{startupCommandBadgeLabel}</span>
          ) : null}

          <span className={`bitfun-shell-nav__terminal-dot${entry.isRunning ? ' is-running' : ' is-stopped'}`} />
        </span>
      </Tooltip>

      <Tooltip content={quickAction.title} placement="right">
        <button
          type="button"
          className="bitfun-shell-nav__terminal-close"
          onClick={(event) => {
            event.stopPropagation();
            quickAction.onClick();
          }}
        >
          {quickAction.icon}
        </button>
      </Tooltip>
    </div>
  );
};

export default ShellNavEntryItem;
