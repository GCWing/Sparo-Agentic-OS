import React, { useEffect } from 'react';
import { useLastUsedWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { appRuntime } from '@/infrastructure/app-runtime';
import { useDialogCompletionNotify } from '../hooks/useDialogCompletionNotify';
import { useSessionProfile } from '../session-profiles';
import { useWorkspaceSurfaceStore } from '../navigation/workspaceSurfaceStore';
import SurfaceRenderer from './SurfaceRenderer';
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
  const activeSurface = useWorkspaceSurfaceStore((s) => s.activeSurface);
  const focusedSessionId = useWorkspaceSurfaceStore((s) => s.focusedSessionId);
  const { profile } = useSessionProfile();
  const { workspace: lastUsedWorkspace } = useLastUsedWorkspace();

  useDialogCompletionNotify();

  useEffect(() => {
    return appRuntime.diagnostics.registerContext(() => {
      const activeSessionId =
        activeSurface.kind === 'session'
          ? activeSurface.sessionId
          : activeSurface.kind === 'agentic-os-home'
            ? activeSurface.agenticOsSessionId ?? focusedSessionId ?? undefined
            : focusedSessionId ?? undefined;

      return {
        activeSceneId: activeSurface.kind === 'scene' ? activeSurface.sceneId : undefined,
        workspacePath: lastUsedWorkspace?.rootPath,
        activeSessionId: activeSessionId ?? undefined,
      };
    });
  }, [activeSurface, focusedSessionId, lastUsedWorkspace?.rootPath]);

  const workspaceClassName = [
    'agentic-os-workspace',
    `agentic-os-workspace--${profile.theme.dataAgent}`,
    `agentic-os-workspace--surface-${activeSurface.kind}`,
  ].filter(Boolean).join(' ');

  return (
    <div className={workspaceClassName}>
      <div className="agentic-os-workspace__content">
        <div className="agentic-os-workspace__surface-slot">
          <SurfaceRenderer
            surface={activeSurface}
            workspacePath={lastUsedWorkspace?.rootPath}
            isEntering={isEntering}
          />
        </div>
      </div>
    </div>
  );
};

export default AgenticOSWorkspace;
