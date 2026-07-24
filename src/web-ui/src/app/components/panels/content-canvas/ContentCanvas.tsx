/**
 * ContentCanvas main container component.
 * Core canvas used by auxiliary and standalone workbench surfaces.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { EditorArea } from './editor-area';
import { AnchorZone } from './anchor-zone';
import { EmptyState } from './empty-state';
import { useCanvasStore } from './stores';
import { useTabLifecycle, useKeyboardShortcuts } from './hooks';
import type { AnchorPosition } from './types';
import { openMainSession, selectActiveChildSessionTab } from '@/flow_chat/services/childSessionPanels';
import './ContentCanvas.scss';
export interface ContentCanvasProps {
  /** Workspace path */
  workspacePath?: string;
  /** App mode */
  mode?: 'agent' | 'project';
  /** Whether the containing scene is currently visible */
  isSceneActive?: boolean;
  /** Interaction callback */
  onInteraction?: (itemId: string, userInput: string) => Promise<void>;
  /** Before-close callback */
  onBeforeClose?: (content: any) => Promise<boolean>;
  /** Disable pop-out and panel-close controls (used in panel-view scene) */
  disablePopOut?: boolean;
  /** Request that the owning host hide this canvas. */
  onRequestClose?: () => void;
}

export const ContentCanvas: React.FC<ContentCanvasProps> = ({
  workspacePath,
  mode = 'agent',
  isSceneActive = true,
  onInteraction,
  disablePopOut = false,
  onRequestClose,
}) => {
  // Store state
  const {
    primaryGroup,
    layout,
    setAnchorPosition,
    setAnchorSize,
  } = useCanvasStore();
  const activeChildSessionTab = useCanvasStore(state => selectActiveChildSessionTab(state as any));
  const activeChildSessionData = activeChildSessionTab?.content.data as
    | { childSessionId: string; parentSessionId: string; workspacePath?: string }
    | undefined;
  const lastSyncedChildSessionTabIdRef = useRef<string | null>(null);
  // Initialize hooks
  const { handleCloseWithDirtyCheck, handleCloseAllWithDirtyCheck } = useTabLifecycle({ mode });
  useKeyboardShortcuts({ enabled: true, handleCloseWithDirtyCheck });
  useEffect(() => {
    if (mode !== 'agent' || !activeChildSessionTab?.id || !activeChildSessionData?.parentSessionId) {
      lastSyncedChildSessionTabIdRef.current = null;
      return;
    }

    if (lastSyncedChildSessionTabIdRef.current === activeChildSessionTab.id) {
      return;
    }

    lastSyncedChildSessionTabIdRef.current = activeChildSessionTab.id;
    void openMainSession(activeChildSessionData.parentSessionId);
  }, [activeChildSessionData?.parentSessionId, activeChildSessionTab?.id, mode]);

  // Check if primary group has visible tabs
  const hasPrimaryVisibleTabs = useMemo(() => {
    const primaryVisible = primaryGroup.tabs.filter(t => !t.isHidden).length;
    return primaryVisible > 0;
  }, [primaryGroup.tabs]);

  // Handle anchor close
  const handleAnchorClose = useCallback(() => {
    setAnchorPosition('hidden');
  }, [setAnchorPosition]);

  // Handle anchor position change
  const handleAnchorPositionChange = useCallback((position: AnchorPosition) => {
    setAnchorPosition(position);
  }, [setAnchorPosition]);

  // Handle anchor size change
  const handleAnchorSizeChange = useCallback((size: number) => {
    setAnchorSize(size);
  }, [setAnchorSize]);

  // Render content
  const renderContent = () => {
    // Show empty state when primary group has no visible tabs
    if (!hasPrimaryVisibleTabs) {
      return <EmptyState onClose={disablePopOut ? undefined : onRequestClose} />;
    }

    return (
      <div className="canvas-content-canvas__main">
        {/* Editor area */}
        <div className="canvas-content-canvas__editor">
          <EditorArea
            workspacePath={workspacePath}
            isSceneActive={isSceneActive}
            onInteraction={onInteraction}
            onTabCloseWithDirtyCheck={handleCloseWithDirtyCheck}
            onTabCloseAllWithDirtyCheck={handleCloseAllWithDirtyCheck}
            disablePopOut={disablePopOut}
          />
        </div>

        {/* Anchor area */}
        {layout.anchorPosition !== 'hidden' && (
          <AnchorZone
            position={layout.anchorPosition}
            size={layout.anchorSize}
            onSizeChange={handleAnchorSizeChange}
            onPositionChange={handleAnchorPositionChange}
            onClose={handleAnchorClose}
          >
            {/* Anchor content (e.g., terminal) renders here */}
            <div className="canvas-content-canvas__anchor-content">
            </div>
          </AnchorZone>
        )}
      </div>
    );
  };

  return (
    <div
      className={`canvas-content-canvas ${layout.isMaximized ? 'is-maximized' : ''}`}
      data-shortcut-scope="canvas"
    >
      {/* Main content */}
      {renderContent()}
    </div>
  );
};
ContentCanvas.displayName = 'ContentCanvas';

export default ContentCanvas;
