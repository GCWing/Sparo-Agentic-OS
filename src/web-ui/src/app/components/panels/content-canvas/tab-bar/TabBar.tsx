/**
 * TabBar component.
 * Tab bar container that manages visibility and overflow.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect } from 'react';
import { Maximize2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  IconButton,
  PanelRightOpenIcon,
  SPARO_ICON_OPTICAL_STROKE_WIDTH,
} from '@/design-system';
import { Tab } from './Tab';
import { TabOverflowMenu } from './TabOverflowMenu';
import type { CanvasTab, EditorGroupId, TabDragPayload } from '../types';
import { createLogger } from '@/shared/utils/logger';
import './TabBar.scss';

const log = createLogger('TabBar');

export interface TabBarProps {
  /** Tab list */
  tabs: CanvasTab[];
  /** Editor group ID */
  groupId: EditorGroupId;
  /** Active tab ID */
  activeTabId: string | null;
  /** Whether this group is active */
  isActiveGroup: boolean;
  /** Click tab */
  onTabClick: (tabId: string) => void;
  /** Double-click tab */
  onTabDoubleClick: (tabId: string) => void;
  /** Close tab */
  onTabClose: (tabId: string) => Promise<void> | void;
  /** Pin tab */
  onTabPin: (tabId: string) => void;
  /** Drag start */
  onDragStart: (payload: TabDragPayload) => void;
  /** Drag end */
  onDragEnd: () => void;
  /** Dragging tab ID */
  draggingTabId: string | null;
  /** Reorder tab */
  onReorderTab: (tabId: string, newIndex: number) => void;
  /** Close all tabs */
  onCloseAllTabs?: () => Promise<void> | void;
  /** Pop out tab as independent scene */
  onTabPopOut?: (tabId: string) => void;
  /** Collapse the panel that owns this tab bar. */
  onRequestClose?: () => void;
  /** Promote the owning auxiliary surface into the current session scene. */
  onRequestSceneFocus?: () => void;
}

/**
 * Estimate tab width based on title length.
 * - Base padding: 6px * 2 = 12px (left/right)
 * - Gap: 4px
 * - Close button: 16px
 * - Char width: ~7px/char (12px font)
 * - CJK chars: ~12px/char
 */
const estimateTabWidth = (title: string): number => {
  const PADDING = 16; // 8px * 2
  const GAP = 4;
  const CLOSE_BTN = 16;
  const MIN_WIDTH = 80;
  const MAX_WIDTH = 180;
  
  // Estimate title width: CJK ~12px, others ~7px
  let titleWidth = 0;
  for (const char of title) {
    // Simple check: CJK unicode range
    if (char.charCodeAt(0) > 255) {
      titleWidth += 12;
    } else {
      titleWidth += 7;
    }
  }
  
  const estimated = PADDING + titleWidth + GAP + CLOSE_BTN;
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, estimated));
};

const tabTitleForWidthEstimate = (tab: CanvasTab, deletedLabel: string): string =>
  tab.fileDeletedFromDisk ? `${tab.title} - ${deletedLabel}` : tab.title;

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  groupId,
  activeTabId,
  isActiveGroup,
  onTabClick,
  onTabDoubleClick,
  onTabClose,
  onTabPin,
  onDragStart,
  onDragEnd,
  draggingTabId,
  onReorderTab,
  onCloseAllTabs,
  onTabPopOut,
  onRequestClose,
  onRequestSceneFocus,
}) => {
  const { t } = useTranslation('components');
  const [visibleTabsCount, setVisibleTabsCount] = useState(tabs.length);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  // Track initial layout measurement completion
  const [layoutReady, setLayoutReady] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const tabsListRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  // Cache actual tab widths (keyed by tab.id + title since title affects width)
  const tabWidthCacheRef = useRef<Map<string, number>>(new Map());

  // Filter out hidden tabs
  const visibleTabs = useMemo(() => tabs.filter(t => !t.isHidden), [tabs]);
  
  // Build cache key (id + title because title changes affect width)
  const getTabCacheKey = useCallback(
    (tab: CanvasTab) => `${tab.id}:${tab.title}:${tab.fileDeletedFromDisk ? '1' : '0'}`,
    []
  );

  // Get tab width: use cache if available, otherwise estimate
  const getTabWidth = useCallback((tab: CanvasTab): number => {
    const cacheKey = getTabCacheKey(tab);
    const cached = tabWidthCacheRef.current.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    // Estimated width
    return estimateTabWidth(tabTitleForWidthEstimate(tab, t('tabs.fileDeleted')));
  }, [getTabCacheKey, t]);

  // Compute visible tab count based on DOM measurements
  const calculateVisibleTabs = useCallback(() => {
    if (!containerRef.current || visibleTabs.length === 0) {
      setVisibleTabsCount(visibleTabs.length);
      setLayoutReady(true);
      return;
    }

    const containerWidth = containerRef.current.clientWidth;
    
    // Measure rendered tabs and update cache
    if (tabsListRef.current) {
      const tabElements = tabsListRef.current.querySelectorAll('.canvas-tab-bar__tab-wrapper');
      tabElements.forEach((el, index) => {
        if (index < visibleTabs.length) {
          const width = (el as HTMLElement).offsetWidth;
          if (width > 0) {
            const cacheKey = getTabCacheKey(visibleTabs[index]);
            tabWidthCacheRef.current.set(cacheKey, width);
          }
        }
      });
    }
    
    // Total width of all tabs
    const allTabWidths = visibleTabs.map(tab => getTabWidth(tab));
    const totalTabsWidth = allTabWidths.reduce((sum, w) => sum + w, 0);
    
    // Base actions width (excluding overflow button)
    // Panel-collapse and close-all buttons: 28px each + gap
    const baseActionsWidth = (onRequestSceneFocus ? 28 : 0)
      + (onRequestClose ? 28 : 0)
      + (onCloseAllTabs ? 28 : 0)
      + 4;
    const overflowBtnWidth = 50;
    // Gap before actions area
    const actionsGap = 8;
    
    // Phase 1: check if all tabs fit without overflow
    const availableWithoutOverflow = containerWidth - baseActionsWidth - actionsGap;
    const canFitAll = totalTabsWidth <= availableWithoutOverflow;
    
    // Compute actual available width
    const actionsWidth = canFitAll ? baseActionsWidth : (baseActionsWidth + overflowBtnWidth);
    const availableWidth = containerWidth - actionsWidth - actionsGap;
    
    // Phase 2: iterate tabs to determine how many fit
    let totalWidth = 0;
    let count = 0;
    
    for (let i = 0; i < visibleTabs.length; i++) {
      const tabWidth = allTabWidths[i];
      
      if (totalWidth + tabWidth <= availableWidth) {
        totalWidth += tabWidth;
        count++;
      } else {
        break;
      }
    }

    // Always show at least one tab
    const finalCount = Math.max(1, Math.min(count, visibleTabs.length));
    setVisibleTabsCount(finalCount);
    setLayoutReady(true);
  }, [
    visibleTabs,
    getTabWidth,
    getTabCacheKey,
    onCloseAllTabs,
    onRequestClose,
    onRequestSceneFocus,
  ]);

  // Reset to render all tabs when list changes (re-measure)
  useEffect(() => {
    // Reset to show all, then let calculateVisibleTabs recompute
    setVisibleTabsCount(visibleTabs.length);
    setLayoutReady(false);
  }, [visibleTabs.length]);

  // Use useLayoutEffect to measure right after DOM update
  useLayoutEffect(() => {
    // Wait a frame to ensure tabs are rendered
    const frameId = requestAnimationFrame(() => {
      calculateVisibleTabs();
    });
    
    return () => cancelAnimationFrame(frameId);
  }, [visibleTabs, calculateVisibleTabs]);

  // Observe container size changes
  useEffect(() => {
    const resizeObserver = new ResizeObserver(() => {
      // Use requestAnimationFrame to avoid frequent recalculations
      requestAnimationFrame(() => {
        calculateVisibleTabs();
      });
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [calculateVisibleTabs]);

  // Split visible and overflow tabs
  const displayedTabs = visibleTabs.slice(0, visibleTabsCount);
  const overflowTabs = visibleTabs.slice(visibleTabsCount);

  // Handle tab drag start
  const handleTabDragStart = useCallback((tab: CanvasTab) => (_e: React.DragEvent) => {
    onDragStart({
      tabId: tab.id,
      sourceGroupId: groupId,
      tab,
    });
  }, [groupId, onDragStart]);

  // Handle drag over
  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  }, []);

  // Handle drag leave
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverIndex(null);
    }
  }, []);

  // Handle drop
  const handleDrop = useCallback((e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverIndex(null);

    if (!draggingTabId) return;

    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      
      // Only reorder within the same group
      if (data.sourceGroupId === groupId) {
        const currentIndex = visibleTabs.findIndex(t => t.id === data.tabId);
        if (currentIndex !== -1 && currentIndex !== targetIndex) {
          onReorderTab(data.tabId, targetIndex);
        }
      }
    } catch (err) {
      log.error('Failed to parse drag data', err);
    }
  }, [draggingTabId, groupId, visibleTabs, onReorderTab]);

  // Clear indicator when drag ends
  useEffect(() => {
    if (!draggingTabId) {
      setDragOverIndex(null);
    }
  }, [draggingTabId]);

  return (
    <div
      ref={containerRef}
      className={`canvas-tab-bar ${isActiveGroup ? 'is-active-group' : ''}`}
    >
      {/* Tab list */}
      <div ref={tabsListRef} className="canvas-tab-bar__tabs">
        {displayedTabs.map((tab, index) => (
          <div
            key={tab.id}
            className="canvas-tab-bar__tab-wrapper"
            onDragOver={(e) => handleDragOver(e, index)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, index)}
          >
            {/* Drop indicator */}
            {dragOverIndex === index && draggingTabId && (
              <div className="canvas-tab-drop-indicator" />
            )}
            
            <Tab
              tab={tab}
              groupId={groupId}
              isActive={activeTabId === tab.id}
              onClick={() => onTabClick(tab.id)}
              onDoubleClick={() => onTabDoubleClick(tab.id)}
              onClose={() => onTabClose(tab.id)}
              onPin={() => onTabPin(tab.id)}
              onDragStart={handleTabDragStart(tab)}
              onDragEnd={onDragEnd}
              isDragging={draggingTabId === tab.id}
              onPopOut={onTabPopOut ? () => onTabPopOut(tab.id) : undefined}
            />
          </div>
        ))}
      </div>

      {/* Actions area */}
      <div ref={actionsRef} className="canvas-tab-bar__actions">
        {/* Overflow menu */}
        {visibleTabs.length > 0 && layoutReady && (
          <TabOverflowMenu
            overflowTabs={overflowTabs}
            activeTabId={activeTabId}
            onTabClick={onTabClick}
            onTabClose={onTabClose}
            onReorderTab={onReorderTab}
          />
        )}

        {onRequestSceneFocus && visibleTabs.length > 0 && (
          <IconButton
            className="canvas-tab-bar__action canvas-tab-bar__action--scene-focus"
            onClick={(event) => {
              event.stopPropagation();
              onRequestSceneFocus();
            }}
            size="xs"
            variant="ghost"
            aria-label={t('canvas.focusInScene')}
            tooltip={t('canvas.focusInScene')}
            tooltipPlacement="bottom"
          >
            <Maximize2 size={14} aria-hidden="true" />
          </IconButton>
        )}

        {onRequestClose && (
          <IconButton
            className="canvas-tab-bar__action canvas-tab-bar__action--collapse-panel"
            onClick={(e) => {
              e.stopPropagation();
              onRequestClose();
            }}
            size="xs"
            variant="ghost"
            aria-label={t('canvas.collapsePanel')}
            tooltip={t('canvas.collapsePanel')}
            tooltipPlacement="bottom"
          >
            <PanelRightOpenIcon
              size={14}
              strokeWidth={SPARO_ICON_OPTICAL_STROKE_WIDTH.compact}
              absoluteStrokeWidth
              aria-hidden="true"
            />
          </IconButton>
        )}

        {/* Close all tabs button */}
        {onCloseAllTabs && visibleTabs.length > 0 && (
          <IconButton
            className="canvas-tab-bar__action canvas-tab-bar__action--close-all"
            onClick={async (e) => {
              e.stopPropagation();
              await onCloseAllTabs();
            }}
            size="xs"
            variant="danger"
            aria-label={t('tabs.closeAll')}
            tooltip={t('tabs.closeAll')}
            tooltipPlacement="bottom"
          >
            <X size={14} />
          </IconButton>
        )}
      </div>
    </div>
  );
};

TabBar.displayName = 'TabBar';

export default TabBar;
