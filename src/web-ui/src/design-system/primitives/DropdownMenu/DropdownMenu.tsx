/**
 * DropdownMenu �?portal-based dropdown that matches the logo-menu visual style.
 *
 * Renders into document.body via a portal so it is never clipped by parent
 * overflow containers. Position is auto-calculated from the provided anchorRef.
 *
 * Submenus fly out to the side (right by default, flips left when the right
 * edge of the screen is too close), exactly like the UnifiedTopBar logo menu.
 * Vertical overflow is also corrected so the submenu never extends below the
 * viewport.
 */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight } from 'lucide-react';
import './DropdownMenu.scss';

// ── Item Types ────────────────────────────────────────────────────────────────

export interface DropdownMenuItemDef {
  type: 'item';
  id: string;
  label: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  /** Shows a checkmark at the end of the row. */
  checked?: boolean;
  /** When provided the item becomes a submenu trigger; onClick is ignored. */
  submenu?: DropdownMenuEntry[];
}

export interface DropdownMenuSeparatorDef {
  type: 'separator';
  id: string;
}

export interface DropdownMenuLabelDef {
  type: 'label';
  id: string;
  /** Single string or array of strings rendered as stacked lines. */
  content: string | string[];
}

export type DropdownMenuEntry =
  | DropdownMenuItemDef
  | DropdownMenuSeparatorDef
  | DropdownMenuLabelDef;

// ── Props ─────────────────────────────────────────────────────────────────────

export interface DropdownMenuProps {
  /** Controls visibility. */
  open: boolean;
  /** Ref to the element the menu is anchored to. */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Menu entries to render. */
  items: DropdownMenuEntry[];
  /** Called when the menu should close (backdrop click, Esc, item click). */
  onClose: () => void;
  /**
   * Horizontal alignment relative to the anchor element.
   * @default 'left'
   */
  align?: 'left' | 'right';
  /**
   * Minimum width of the menu in pixels.
   * @default 160
   */
  minWidth?: number;
}

// ── Shared item renderer (used by both root menu and submenu) ─────────────────

interface MenuItemProps {
  entry: DropdownMenuItemDef;
  onClose: () => void;
  isSubmenuOpen?: boolean;
  onSubmenuTrigger?: () => void;
}

const MenuItem: React.FC<MenuItemProps> = ({ entry, onClose, isSubmenuOpen, onSubmenuTrigger }) => {
  const hasSubmenu = Boolean(entry.submenu?.length);

  const handleClick = () => {
    if (hasSubmenu) {
      onSubmenuTrigger?.();
    } else if (!entry.disabled) {
      entry.onClick?.();
      onClose();
    }
  };

  return (
    <button
      type="button"
      role="menuitem"
      className={`cl-dropdown-menu__item${isSubmenuOpen ? ' is-open' : ''}${entry.checked ? ' is-checked' : ''}`}
      disabled={!hasSubmenu && entry.disabled}
      aria-haspopup={hasSubmenu || undefined}
      aria-expanded={hasSubmenu ? isSubmenuOpen : undefined}
      aria-checked={entry.checked}
      onClick={handleClick}
    >
      <span className="cl-dropdown-menu__item-label">{entry.label}</span>
      {entry.checked ? (
        <Check size={13} className="cl-dropdown-menu__check-icon" aria-hidden="true" />
      ) : null}
      {hasSubmenu ? (
        <ChevronRight
          size={13}
          className={`cl-dropdown-menu__submenu-icon${isSubmenuOpen ? ' is-open' : ''}`}
          aria-hidden="true"
        />
      ) : null}
    </button>
  );
};

// ── Submenu panel ─────────────────────────────────────────────────────────────

interface SubmenuPanelProps {
  items: DropdownMenuEntry[];
  /** Direction of the flyout relative to the trigger row. */
  direction: 'left' | 'right';
  onClose: () => void;
}

const SubmenuPanel: React.FC<SubmenuPanelProps> = ({ items, direction, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [topOffset, setTopOffset] = useState(0);

  // After mount: correct vertical overflow so the panel stays within the viewport.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const overflow = rect.bottom - (window.innerHeight - 8);
    if (overflow > 0) {
      setTopOffset(-Math.min(overflow, rect.top - 8));
    }
  }, []);

  return (
    <div
      ref={ref}
      className={`cl-dropdown-menu__submenu is-${direction}`}
      role="menu"
      style={topOffset ? { top: topOffset } : undefined}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((entry) => {
        if (entry.type === 'separator') {
          return (
            <div
              key={entry.id}
              className="cl-dropdown-menu__separator"
              role="separator"
              aria-orientation="horizontal"
            />
          );
        }
        if (entry.type === 'label') {
          const lines = Array.isArray(entry.content) ? entry.content : [entry.content];
          return (
            <div key={entry.id} className="cl-dropdown-menu__label" role="presentation">
              {lines.map((line, i) => <span key={i}>{line}</span>)}
            </div>
          );
        }
        return (
          <MenuItem key={entry.id} entry={entry} onClose={onClose} />
        );
      })}
    </div>
  );
};

// ── Root menu entries renderer ────────────────────────────────────────────────

interface MenuEntriesProps {
  items: DropdownMenuEntry[];
  onClose: () => void;
  openSubmenuId: string | null;
  submenuDirection: 'left' | 'right';
  onSubmenuTrigger: (id: string) => void;
}

const MenuEntries: React.FC<MenuEntriesProps> = ({
  items, onClose, openSubmenuId, submenuDirection, onSubmenuTrigger,
}) => (
  <>
    {items.map((entry) => {
      if (entry.type === 'separator') {
        return (
          <div
            key={entry.id}
            className="cl-dropdown-menu__separator"
            role="separator"
            aria-orientation="horizontal"
          />
        );
      }
      if (entry.type === 'label') {
        const lines = Array.isArray(entry.content) ? entry.content : [entry.content];
        return (
          <div key={entry.id} className="cl-dropdown-menu__label" role="presentation">
            {lines.map((line, i) => <span key={i}>{line}</span>)}
          </div>
        );
      }

      const hasSubmenu = Boolean(entry.submenu?.length);
      const submenuOpen = openSubmenuId === entry.id;

      return (
        <div key={entry.id} className="cl-dropdown-menu__submenu-wrap">
          <MenuItem
            entry={entry}
            onClose={onClose}
            isSubmenuOpen={submenuOpen}
            onSubmenuTrigger={hasSubmenu ? () => onSubmenuTrigger(entry.id) : undefined}
          />
          {hasSubmenu && submenuOpen && entry.submenu ? (
            <SubmenuPanel
              items={entry.submenu}
              direction={submenuDirection}
              onClose={onClose}
            />
          ) : null}
        </div>
      );
    })}
  </>
);

// ── DropdownMenu ──────────────────────────────────────────────────────────────

export const DropdownMenu: React.FC<DropdownMenuProps> = ({
  open,
  anchorRef,
  items,
  onClose,
  align = 'left',
  minWidth = 160,
}) => {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);
  const [submenuDirection, setSubmenuDirection] = useState<'left' | 'right'>('right');
  const menuRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const PADDING = 8;
    const top = rect.bottom + 4;

    let left: number;
    if (align === 'right') {
      left = rect.right - minWidth;
    } else {
      left = rect.left;
    }
    left = Math.min(left, window.innerWidth - minWidth - PADDING);
    left = Math.max(left, PADDING);

    setPosition({ top, left });
  }, [align, anchorRef, minWidth]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      setOpenSubmenuId(null);
      return;
    }
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => updatePosition();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (openSubmenuId) {
          setOpenSubmenuId(null);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, openSubmenuId]);

  if (!open || !position || typeof document === 'undefined') return null;

  const handleSubmenuTrigger = (id: string) => {
    const menuEl = menuRef.current;
    if (menuEl) {
      const rect = menuEl.getBoundingClientRect();
      setSubmenuDirection(window.innerWidth - rect.right >= 180 ? 'right' : 'left');
    }
    setOpenSubmenuId((prev) => (prev === id ? null : id));
  };

  return createPortal(
    <>
      <div
        className="cl-dropdown-menu__backdrop"
        aria-hidden="true"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onClose}
      />
      <div
        ref={menuRef}
        className="cl-dropdown-menu"
        role="menu"
        style={{ top: position.top, left: position.left, minWidth }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <MenuEntries
          items={items}
          onClose={onClose}
          openSubmenuId={openSubmenuId}
          submenuDirection={submenuDirection}
          onSubmenuTrigger={handleSubmenuTrigger}
        />
      </div>
    </>,
    document.body,
  );
};
