/**
 * AgenticOSWorkspace - two-layer scene container.
 *
 * The top bar (UnifiedTopBar) lives in WorkspaceBody above this component.
 * This component owns only the content area:
 *
 *   content area  (flex:1)
 *     scene-slot[session] - always mounted to preserve Agentic OS state
 *     scene-slot[overlay] - mounted on demand and animated above the base
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
  const hasActiveOverlay = activeOverlay !== null;

  useDialogCompletionNotify();

  const workspaceClassName = [
    'agentic-os-workspace',
    `agentic-os-workspace--${profile.theme.dataAgent}`,
    hasActiveOverlay ? 'agentic-os-workspace--has-overlay' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={workspaceClassName}>
      <div className="agentic-os-workspace__content">
        <div
          className="agentic-os-workspace__scene-slot agentic-os-workspace__scene-slot--base"
          aria-hidden={hasActiveOverlay}
        >
          <SessionScene
            workspacePath={lastUsedWorkspace?.rootPath}
            isEntering={isEntering}
            isActive={!hasActiveOverlay}
          />
        </div>

        {activeOverlay && (
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
