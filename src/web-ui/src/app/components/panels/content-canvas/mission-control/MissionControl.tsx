/**
 * MissionControl component.
 * Mission control overlay showing thumbnails of all open files.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { X, Merge } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '@/design-system';
import { ThumbnailCard } from './ThumbnailCard';
import { SearchFilter } from './SearchFilter';
import { useCanvasStore } from '../stores';
import type { EditorGroupId } from '../types';
import './MissionControl.scss';

export interface MissionControlProps {
  /** Whether open */
  isOpen: boolean;
  /** Close callback */
  onClose: () => void;
  /** Dirty-check callback before closing tab */
  handleCloseWithDirtyCheck?: (tabId: string, groupId: EditorGroupId) => Promise<boolean>;
}

export const MissionControl: React.FC<MissionControlProps> = ({
  isOpen,
  onClose,
  handleCloseWithDirtyCheck,
}) => {
  const { t } = useTranslation('components');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroups, setSelectedGroups] = useState<Set<EditorGroupId>>(new Set(['primary', 'secondary', 'tertiary']));
  const [, setDraggingTabId] = useState<string | null>(null);
  const {
    primaryGroup,
    secondaryGroup,
    tertiaryGroup,
    activeGroupId,
    layout,
    switchToTab,
    closeTab,
    togglePinTab,
    setSplitMode,
  } = useCanvasStore();
  // Organize tabs by group
  const organizedTabs = useMemo(() => {
    const primary = primaryGroup.tabs
      .filter(t => !t.isHidden)
      .map(t => ({ tab: t, groupId: 'primary' as EditorGroupId }));
    const secondary = secondaryGroup.tabs
      .filter(t => !t.isHidden)
      .map(t => ({ tab: t, groupId: 'secondary' as EditorGroupId }));
    const tertiary = tertiaryGroup.tabs
      .filter(t => !t.isHidden)
      .map(t => ({ tab: t, groupId: 'tertiary' as EditorGroupId }));

    return {
      primary,
      secondary,
      tertiary,
      all: [...primary, ...secondary, ...tertiary],
    };
  }, [primaryGroup.tabs, secondaryGroup.tabs, tertiaryGroup.tabs]);

  // Aggregate all tabs (for search and stats)
  const allTabs = organizedTabs.all;

  // Filter matching tabs (search + group filter)
  const filteredTabs = useMemo(() => {
    let result = allTabs;
    
    // Filter by group first
    if (selectedGroups.size < 3) {
      result = result.filter(({ groupId }) => selectedGroups.has(groupId));
    }
    
    // Then filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(({ tab }) => {
        return (
          tab.title.toLowerCase().includes(query) ||
          tab.content.data?.filePath?.toLowerCase().includes(query) ||
          tab.content.type.toLowerCase().includes(query)
        );
      });
    }
    
    return result;
  }, [allTabs, searchQuery, selectedGroups]);

  // Active tab ID
  const activeTabId = useMemo(() => {
    const group = activeGroupId === 'primary' 
      ? primaryGroup 
      : activeGroupId === 'secondary' 
        ? secondaryGroup 
        : tertiaryGroup;
    return group.activeTabId;
  }, [activeGroupId, primaryGroup, secondaryGroup, tertiaryGroup]);

  // Keyboard handling
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Close on backdrop click
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  // Handle tab click
  const handleTabClick = useCallback((tabId: string, groupId: EditorGroupId) => {
    switchToTab(tabId, groupId);
    onClose();
  }, [switchToTab, onClose]);

  // Handle tab close
  const handleTabClose = useCallback(async (tabId: string, groupId: EditorGroupId) => {
    if (handleCloseWithDirtyCheck) {
      await handleCloseWithDirtyCheck(tabId, groupId);
      return;
    }
    closeTab(tabId, groupId);
  }, [closeTab, handleCloseWithDirtyCheck]);

  // Handle pin
  const handleTabPin = useCallback((tabId: string, groupId: EditorGroupId) => {
    togglePinTab(tabId, groupId);
  }, [togglePinTab]);

  // Drag start
  const handleDragStart = useCallback((tabId: string) => (_e: React.DragEvent) => {
    setDraggingTabId(tabId);
  }, []);

  // Drag end
  const handleDragEnd = useCallback(() => {
    setDraggingTabId(null);
  }, []);

  // Reset search and filters
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setSelectedGroups(new Set(['primary', 'secondary', 'tertiary']));
    }
  }, [isOpen]);

  // Toggle group filter
  const toggleGroupFilter = useCallback((groupId: EditorGroupId) => {
    setSelectedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  // Check for multiple groups
  const hasMultipleGroups = useMemo(() => {
    return layout.splitMode !== 'none';
  }, [layout.splitMode]);

  // Merge all groups into primary
  const handleMergeAll = useCallback(() => {
    setSplitMode('none');
    onClose();
  }, [setSplitMode, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="canvas-mission-control"
      onClick={handleBackdropClick}
    >
      <div className="canvas-mission-control__content">
        {/* Header */}
        <div className="canvas-mission-control__header">
          <h2 className="canvas-mission-control__title">{t('tabs.missionControl')}</h2>
          <div className="canvas-mission-control__header-actions">
            {hasMultipleGroups && (
              <Button
                className="canvas-mission-control__merge-action"
                variant="secondary"
                size="small"
                onClick={handleMergeAll}
                title={t('canvas.mergeAllGroups')}
              >
                <Merge size={14} />
                <span>{t('canvas.mergeAll')}</span>
              </Button>
            )}
            <IconButton
              className="canvas-mission-control__close-control"
              size="xs"
              variant="ghost"
              onClick={onClose}
              aria-label={t('canvas.closeEsc')}
              tooltip={t('canvas.closeEsc')}
            >
              <X size={14} />
            </IconButton>
          </div>
        </div>

        {/* Search and filter area */}
        <div className="canvas-mission-control__filters">
          <div className="canvas-mission-control__filters-row">
            <div className="canvas-mission-control__search-wrapper">
              <SearchFilter
                value={searchQuery}
                onChange={setSearchQuery}
                matchCount={filteredTabs.length}
                totalCount={allTabs.length}
              />
            </div>
            
            {/* Group filters - compact icon buttons */}
            {hasMultipleGroups && (
              <div className="canvas-mission-control__group-filters">
                {[
                  { id: 'primary' as EditorGroupId, labelKey: 'canvas.groupPrimaryFull', shortLabelKey: 'canvas.groupPrimary', color: 'var(--ds-color-accent-600)', colorRgb: '59, 130, 246' },
                  { id: 'secondary' as EditorGroupId, labelKey: 'canvas.groupSecondaryFull', shortLabelKey: 'canvas.groupSecondary', color: 'var(--ds-color-success)', colorRgb: '16, 185, 129' },
                  { id: 'tertiary' as EditorGroupId, labelKey: 'canvas.groupTertiaryFull', shortLabelKey: 'canvas.groupTertiary', color: 'var(--ds-color-warning)', colorRgb: '245, 158, 11' },
                ].map(({ id, labelKey, shortLabelKey, color, colorRgb }) => {
                  const hasTabs = organizedTabs[id as keyof typeof organizedTabs].length > 0;
                  if (!hasTabs) return null;
                  
                  return (
                    <Button
                      key={id}
                      className={`canvas-mission-control__group-filter ${selectedGroups.has(id) ? 'is-active' : ''}`}
                      variant="ghost"
                      size="small"
                      onClick={() => toggleGroupFilter(id)}
                      title={t(labelKey)}
                      aria-label={t(labelKey)}
                      aria-pressed={selectedGroups.has(id)}
                      style={{ 
                        '--group-color': color,
                        '--group-color-rgb': colorRgb,
                      } as React.CSSProperties}
                    >
                      <span className="canvas-mission-control__group-filter-indicator" />
                      <span className="canvas-mission-control__group-filter-text">{t(shortLabelKey)}</span>
                    </Button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Thumbnail grid - unified display */}
        <div className="canvas-mission-control__grid">
          {filteredTabs.length > 0 ? (
            filteredTabs.map(({ tab, groupId }) => (
              <ThumbnailCard
                key={tab.id}
                tab={tab}
                groupId={groupId}
                isActive={tab.id === activeTabId && groupId === activeGroupId}
                onClick={() => handleTabClick(tab.id, groupId)}
                onClose={() => handleTabClose(tab.id, groupId)}
                onPin={() => handleTabPin(tab.id, groupId)}
                onDragStart={handleDragStart(tab.id)}
                onDragEnd={handleDragEnd}
              />
            ))
          ) : (
            <div className="canvas-mission-control__empty">
              {searchQuery || selectedGroups.size < 3 ? (
                <span>{t('canvas.noMatchingFiles')}</span>
              ) : (
                <span>{t('canvas.noOpenFiles')}</span>
              )}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="canvas-mission-control__footer">
          <span>{t('canvas.clickToSwitch')}</span>
          <div className="canvas-mission-control__separator" />
          <span><kbd>Esc</kbd> {t('canvas.exit')}</span>
        </div>
      </div>
    </div>
  );
};

MissionControl.displayName = 'MissionControl';

export default MissionControl;
