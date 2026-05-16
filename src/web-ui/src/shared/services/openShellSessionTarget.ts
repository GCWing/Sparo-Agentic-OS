import { openWorkspaceScene } from '@/app/navigation/workspaceNavigation';
import { useWorkspaceSurfaceStore } from '@/app/navigation/workspaceSurfaceStore';
import { useTerminalSceneStore } from '@/app/stores/terminalSceneStore';
import { createTerminalTab } from '@/shared/utils/tabUtils';

interface OpenShellSessionTargetOptions {
  sessionId: string;
  sessionName: string;
}

function openStandaloneShellSession(sessionId: string): void {
  const terminalState = useTerminalSceneStore.getState();

  openWorkspaceScene('shell');

  // Force a remount when reopening the same session so the terminal view
  // can recover from stale/error state and always reflect the latest selection.
  if (terminalState.activeSessionId === sessionId) {
    terminalState.setActiveSession(null);
    window.setTimeout(() => {
      useTerminalSceneStore.getState().setActiveSession(sessionId);
    }, 0);
    return;
  }

  terminalState.setActiveSession(sessionId);
}

/**
 * Unified shell open strategy:
 * - stay inside Agent right tabs when a session surface is active
 * - otherwise open the standalone shell scene
 */
export function openShellSessionTarget(options: OpenShellSessionTargetOptions): void {
  const { sessionId, sessionName } = options;
  const { activeSurface } = useWorkspaceSurfaceStore.getState();

  if (activeSurface.kind !== 'scene') {
    createTerminalTab(sessionId, sessionName, 'agent');
    return;
  }

  openStandaloneShellSession(sessionId);
}
