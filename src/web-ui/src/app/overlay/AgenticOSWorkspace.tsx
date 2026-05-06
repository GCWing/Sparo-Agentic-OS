/**
 * AgenticOSWorkspace — two-layer scene container.
 *
 * The top bar (UnifiedTopBar) now lives in WorkspaceBody above this component.
 * This component owns only the content area:
 *
 *   content area  (flex:1)
 *     scene-slot[session]  — always mounted, CSS display:none when overlay active
 *     scene-slot[overlay]  — mounted on demand, CSS display:flex when active
 *
 * Scenes are never stacked; only one slot is visible at a time.
 * SessionScene stays mounted (display:none) to preserve its state.
 */

import React from 'react';
import { useOverlayStore } from '../stores/overlayStore';
import { useSessionProfile } from '../session-profiles';
import { useLastUsedWorkspace } from '../../infrastructure/contexts/WorkspaceContext';
import { useDialogCompletionNotify } from '../hooks/useDialogCompletionNotify';
import SessionScene from '../scenes/session/SessionScene';
import OverlaySceneRenderer from './OverlaySceneRenderer';
import './AgenticOSWorkspace.scss';

interface AgenticOSWorkspaceProps {
  isEntering?: boolean;
  onMinimize?: () => void;
  onMaximize?: () => void;
  onClose?: () => void;
  isMaximized?: boolean;
}

const AgenticOSWorkspace: React.FC<AgenticOSWorkspaceProps> = ({
  isEntering = false,
}) => {
  const activeOverlay = useOverlayStore(s => s.activeOverlay);
  const { profile } = useSessionProfile();
  const { workspace: lastUsedWorkspace } = useLastUsedWorkspace();
  const hasOverlay = activeOverlay !== null;

  useDialogCompletionNotify();

  return (
    <div
      className={`agentic-os-workspace agentic-os-workspace--${profile.theme.dataAgent}`}
    >
      {/* Content area — single slot visible at a time, no stacking */}
      <div className="agentic-os-workspace__content">

        {/* Base session — always mounted, hidden (not removed) when overlay is active */}
        <div
          className="agentic-os-workspace__scene-slot"
          aria-hidden={hasOverlay}
          style={hasOverlay ? { display: 'none' } : undefined}
        >
          <SessionScene
            workspacePath={lastUsedWorkspace?.rootPath}
            isEntering={isEntering}
            isActive={!hasOverlay}
          />
        </div>

        {/* Overlay scene — mounted when active, fills the full content area */}
        {hasOverlay && activeOverlay && (
          <div className="agentic-os-workspace__scene-slot agentic-os-workspace__scene-slot--overlay">
            <OverlaySceneRenderer
              overlayId={activeOverlay}
              workspacePath={lastUsedWorkspace?.rootPath}
            />
          </div>
        )}

      </div>
    </div>
  );
};

export default AgenticOSWorkspace;
