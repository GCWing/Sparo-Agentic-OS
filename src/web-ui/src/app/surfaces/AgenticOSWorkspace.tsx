import React, { useEffect } from 'react';
import { appRuntime } from '@/infrastructure/app-runtime';
import { useDialogCompletionNotify } from '../hooks/useDialogCompletionNotify';
import { useSessionProfile } from '../session-profiles';
import { useWorkspaceSurfaceStore, selectFocusedSessionId } from '../navigation/workspaceSurfaceStore';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import {
  projectWorkspacePathFromRuntimeScope,
  runtimeScopeFromSession,
} from '@/shared/types/runtime-scope';
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
  const currentOsSessionId = useWorkspaceSurfaceStore((s) => s.currentOsSessionId);
  const focusedSessionId = useWorkspaceSurfaceStore(selectFocusedSessionId);
  const { profile } = useSessionProfile();

  useDialogCompletionNotify();

  useEffect(() => {
    return appRuntime.diagnostics.registerContext(() => {
      const activeSessionId =
        activeSurface.kind === 'session'
          ? activeSurface.sessionId
          : activeSurface.kind === 'agentic-os-home'
            ? currentOsSessionId ?? focusedSessionId ?? undefined
            : focusedSessionId ?? undefined;
      const sessionScope = activeSessionId
        ? runtimeScopeFromSession(flowChatStore.getState().sessions.get(activeSessionId))
        : null;
      const activeWorkspacePath =
        activeSurface.kind === 'scene'
          ? projectWorkspacePathFromRuntimeScope(activeSurface.scope)
          : projectWorkspacePathFromRuntimeScope(sessionScope);

      return {
        activeSceneId: activeSurface.kind === 'scene' ? activeSurface.sceneId : undefined,
        workspacePath: activeWorkspacePath,
        activeSessionId: activeSessionId ?? undefined,
      };
    });
  }, [activeSurface, currentOsSessionId, focusedSessionId]);

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
            isEntering={isEntering}
          />
        </div>
      </div>
    </div>
  );
};

export default AgenticOSWorkspace;
