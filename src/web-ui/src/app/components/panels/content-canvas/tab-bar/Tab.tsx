/**
 * Tab component.
 * Supports preview/active/pinned tab states.
 */

import React, { useCallback, useState } from 'react';
import { X, Pin, Split, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton, Tooltip } from '@/design-system';
import type { CanvasTab, EditorGroupId, TabState } from '../types';
import './Tab.scss';
export interface TabProps {
  /** Tab data */
  tab: CanvasTab;
  /** Editor group ID */
  groupId: EditorGroupId;
  /** Whether active tab */
  isActive: boolean;
  /** Click callback */
  onClick: () => void;
  /** Double-click callback */
  onDoubleClick: () => void;
  /** Close callback */
  onClose: () => Promise<void> | void;
  /** Pin/unpin callback */
  onPin: () => void;
  /** Drag start callback */
  onDragStart: (e: React.DragEvent) => void;
  /** Drag end callback */
  onDragEnd: () => void;
  /** Whether being dragged */
  isDragging?: boolean;
  /** Pop out as independent scene */
  onPopOut?: () => void;
}

/**
 * Get class name for tab state.
 */
const getStateClassName = (state: TabState): string => {
  switch (state) {
    case 'preview':
      return 'is-preview';
    case 'pinned':
      return 'is-pinned';
    default:
      return '';
  }
};

export const Tab: React.FC<TabProps> = ({
  tab,
  groupId,
  isActive,
  onClick,
  onDoubleClick,
  onClose,
  onPin,
  onDragStart,
  onDragEnd,
  isDragging = false,
  onPopOut,
}) => {
  const { t } = useTranslation('components');
  const [isHovered, setIsHovered] = useState(false);

  // Build tooltip text
  const unsavedSuffix = tab.isDirty ? ` (${t('tabs.unsaved')})` : '';
  const deletedSuffix = tab.fileDeletedFromDisk ? ` - ${t('tabs.fileDeleted')}` : '';
  const titleDisplay = `${tab.title}${deletedSuffix}`;
  const tooltipText = tab.content.data?.filePath
    ? `${tab.content.data.filePath}${deletedSuffix}${unsavedSuffix}`
    : `${titleDisplay}${unsavedSuffix}`;

  // Handle single click - respond immediately
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onClick();
  }, [onClick]);

  // Handle double click - rely on native onDoubleClick
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDoubleClick();
  }, [onDoubleClick]);

  // Handle close click
  const handleCloseClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    await onClose();
  }, [onClose]);

  // Handle pin click
  const handlePinClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onPin();
  }, [onPin]);

  // Handle pop out click
  const handlePopOutClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onPopOut?.();
  }, [onPopOut]);

  // Handle drag start
  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      tabId: tab.id,
      sourceGroupId: groupId,
    }));
    e.dataTransfer.effectAllowed = 'move';
    onDragStart(e);
  }, [tab.id, groupId, onDragStart]);

  // Handle context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const isPinned = tab.state === 'pinned';

  /** Middle-click closes (same as SceneBar session tabs); skip pinned and pin/popout controls. */
  const handleMiddleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 1) return;
    if (isPinned) return;
    const target = e.target as HTMLElement;
    if (target.closest('.canvas-tab__pin-icon') || target.closest('.canvas-tab__popout-action')) return;
    e.preventDefault();
  }, [isPinned]);

  const handleAuxClick = useCallback((e: React.MouseEvent) => {
    if (e.button !== 1) return;
    if (isPinned) return;
    const target = e.target as HTMLElement;
    if (target.closest('.canvas-tab__pin-icon') || target.closest('.canvas-tab__popout-action')) return;
    e.preventDefault();
    e.stopPropagation();
    void onClose();
  }, [isPinned, onClose]);

  const isTaskDetail = tab.content.type === 'task-detail';

  // Build class names
  const classNames = [
    'canvas-tab',
    isActive && 'is-active',
    tab.isDirty && 'is-dirty',
    tab.fileDeletedFromDisk && 'is-file-deleted',
    isDragging && 'is-dragging',
    getStateClassName(tab.state),
    isTaskDetail && 'is-task-detail',
  ].filter(Boolean).join(' ');

  // Show close button only while hovering to avoid reserving layout space.
  const showCloseButton = isHovered;

  return (
    <Tooltip content={tooltipText} placement="bottom">
      <div
        className={classNames}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onMouseDown={handleMiddleMouseDown}
        onAuxClick={handleAuxClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={onDragEnd}
      >
        {/* Pin icon */}
        {tab.state === 'pinned' && (
          <IconButton
            className="canvas-tab__pin-icon"
            size="xs"
            variant="ghost"
            onClick={handlePinClick}
            aria-label={t('tabs.unpin')}
            tooltip={t('tabs.unpin')}
            tooltipPlacement="bottom"
          >
            <Pin size={12} />
          </IconButton>
        )}

        {/* Task-detail type icon */}
        {isTaskDetail && (
          <Split size={12} className="canvas-tab__type-icon" aria-hidden />
        )}

        {/* Title */}
        <span className="canvas-tab__title">
          {titleDisplay}
        </span>

        {/* Dirty state indicator */}
        {tab.isDirty && (
          <span
            className="canvas-tab__dirty-indicator"
            title={t('tabs.unsaved')}
            aria-label={t('tabs.unsaved')}
          />
        )}

        {/* Pop out button */}
        {showCloseButton && onPopOut && (
          <IconButton
            className="canvas-tab__popout-action"
            size="xs"
            variant="ghost"
            onClick={handlePopOutClick}
            aria-label={t('tabs.popOut', 'Pop out as scene')}
            tooltip={t('tabs.popOut', 'Pop out as scene')}
            tooltipPlacement="bottom"
          >
            <ExternalLink size={12} />
          </IconButton>
        )}

        {/* Close button */}
        {showCloseButton && (
          <IconButton
            className="canvas-tab__close-action"
            size="xs"
            variant="ghost"
            onClick={handleCloseClick}
            aria-label={t('tabs.close')}
            tooltip={t('tabs.close')}
            tooltipPlacement="bottom"
          >
            <X size={12} />
          </IconButton>
        )}

      </div>
    </Tooltip>
  );
};

Tab.displayName = 'Tab';

export default Tab;
