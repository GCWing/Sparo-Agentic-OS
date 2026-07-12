/**
 * TabOverflowMenu component.
 * Shows tabs that do not fit in the tab bar.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/design-system';
import { useMovingHoverHighlight } from '@/shared/hooks/useMovingHoverHighlight';
import type { CanvasTab } from '../types';
import './TabOverflowMenu.scss';
export interface TabOverflowMenuProps {
  /** Overflow tabs */
  overflowTabs: CanvasTab[];
  /** Active tab ID */
  activeTabId: string | null;
  /** Tab click callback */
  onTabClick: (tabId: string) => void;
  /** Close tab callback */
  onTabClose: (tabId: string) => Promise<void> | void;
  /** Reorder tab callback (move to index) */
  onReorderTab: (tabId: string, newIndex: number) => void;
}

export const TabOverflowMenu: React.FC<TabOverflowMenuProps> = ({
  overflowTabs,
  activeTabId,
  onTabClick,
  onTabClose,
  onReorderTab,
}) => {
  const { t } = useTranslation('components');
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const itemHover = useMovingHoverHighlight<HTMLDivElement>();
  const menuRef = itemHover.surfaceRef;

  const hasOverflow = overflowTabs.length > 0;

  // Update menu position
  const updateMenuPosition = useCallback(() => {
    if (wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      const menuWidth = 240;
      
      // Compute left to keep menu within right boundary
      let left = rect.left;
      if (left + menuWidth > window.innerWidth) {
        left = rect.right - menuWidth;
      }
      
      setMenuPosition({
        top: rect.bottom + 4,
        left: Math.max(8, left),
      });
    }
  }, []);

  // Button click
  const handleButtonClick = useCallback(() => {
    if (!isOpen) {
      updateMenuPosition();
    }
    setIsOpen(prev => !prev);
  }, [isOpen, updateMenuPosition]);

  // Close menu on outside click
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        wrapperRef.current &&
        !wrapperRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    // Delay listener to avoid triggering the current click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, menuRef]);

  // Handle tab click
  const handleTabClick = useCallback((tabId: string) => {
    // Move tab to front (index 0) so it becomes visible
    onReorderTab(tabId, 0);
    // Then switch to the tab
    onTabClick(tabId);
    setIsOpen(false);
  }, [onTabClick, onReorderTab]);

  // Handle close click
  const handleCloseClick = useCallback(async (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    await onTabClose(tabId);
  }, [onTabClose]);

  const handleItemMiddleMouseDown = useCallback((e: React.MouseEvent, tab: CanvasTab) => {
    if (e.button !== 1) return;
    if (tab.state === 'pinned') return;
    const target = e.target as HTMLElement;
    if (target.closest('.canvas-tab-overflow-menu__entry-close')) return;
    e.preventDefault();
  }, []);

  const handleItemAuxClick = useCallback(
    async (e: React.MouseEvent, tab: CanvasTab) => {
      if (e.button !== 1) return;
      if (tab.state === 'pinned') return;
      const target = e.target as HTMLElement;
      if (target.closest('.canvas-tab-overflow-menu__entry-close')) return;
      e.preventDefault();
      e.stopPropagation();
      await onTabClose(tab.id);
      setIsOpen(false);
    },
    [onTabClose]
  );

  if (!hasOverflow) {
    return null;
  }

  const tooltipContent = t('tabs.hiddenTabsCount', { count: overflowTabs.length });

  return (
    <div ref={wrapperRef} className="canvas-tab-panorama-wrapper">
      <IconButton
        className={`canvas-tab-panorama-control has-overflow ${isOpen ? 'is-open' : ''}`}
        onClick={handleButtonClick}
        size="xs"
        variant="ghost"
        aria-label={tooltipContent}
        tooltip={tooltipContent}
        tooltipPlacement="bottom"
      >
        <ChevronDown size={14} />
        <span className="canvas-tab-panorama-control__badge">
          +{overflowTabs.length}
        </span>
      </IconButton>

      {isOpen && hasOverflow && createPortal(
        <div
          ref={menuRef}
          className="canvas-tab-overflow-menu canvas-tab-overflow-menu--motion"
          style={{
            position: 'fixed',
            top: `${menuPosition.top}px`,
            left: `${menuPosition.left}px`,
          }}
          {...itemHover.getSurfaceHandlers('.canvas-tab-overflow-menu__entry')}
        >
          <div
            className="canvas-tab-overflow-menu__hover-highlight"
            style={{
              transform: `translate3d(${itemHover.highlight.left}px, ${itemHover.highlight.top}px, 0) scale(${itemHover.highlight.stretchX}, ${itemHover.highlight.stretchY})`,
              width: `${itemHover.highlight.width}px`,
              height: `${itemHover.highlight.height}px`,
              opacity: itemHover.highlight.visible ? 1 : 0,
            }}
          />

          {/* Overflow tab list */}
          <div className="canvas-tab-overflow-menu__list">
            {overflowTabs.map((tab) => {
              const deletedSuffix = tab.fileDeletedFromDisk ? ` - ${t('tabs.fileDeleted')}` : '';
              const titleWithDeleted = `${tab.title}${deletedSuffix}`;
              return (
              <div
                key={tab.id}
                className={`canvas-tab-overflow-menu__entry ${
                  activeTabId === tab.id ? 'is-active' : ''
                } ${tab.isDirty ? 'is-dirty' : ''} ${tab.fileDeletedFromDisk ? 'is-file-deleted' : ''}`}
                onClick={() => handleTabClick(tab.id)}
                onMouseDown={(e) => handleItemMiddleMouseDown(e, tab)}
                onAuxClick={(e) => void handleItemAuxClick(e, tab)}
                onMouseEnter={(event) => {
                  itemHover.updateHighlight(event.currentTarget);
                }}
                onPointerEnter={(event) => {
                  itemHover.updateHighlight(event.currentTarget);
                }}
              >
                <span className="canvas-tab-overflow-menu__entry-title">
                  {tab.state === 'preview' && <em>{titleWithDeleted}</em>}
                  {tab.state !== 'preview' && titleWithDeleted}
                </span>
                
                {tab.isDirty && (
                  <span
                    className="canvas-tab-overflow-menu__entry-dirty"
                    aria-label={t('tabs.unsaved')}
                  />
                )}
                
                <IconButton
                  className="canvas-tab-overflow-menu__entry-close"
                  onClick={(e) => handleCloseClick(e, tab.id)}
                  size="xs"
                  variant="danger"
                  aria-label={t('tabs.close')}
                  tooltip={t('tabs.close')}
                  tooltipPlacement="left"
                >
                  <X size={12} />
                </IconButton>
              </div>
            );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

TabOverflowMenu.displayName = 'TabOverflowMenu';

export default TabOverflowMenu;
