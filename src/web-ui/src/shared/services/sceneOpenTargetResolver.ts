import type { WorkspaceSceneId } from '@/app/navigation/workspaceSceneTypes';
import { openWorkspaceScene } from '@/app/navigation/workspaceNavigation';
import { useWorkspaceSurfaceStore } from '@/app/navigation/workspaceSurfaceStore';

export type OpenIntent = 'file' | 'terminal';
export type OpenTargetMode = 'agent' | 'project';
export type OpenSource = 'default' | 'project-nav';

export interface OpenTargetResolution {
  mode: OpenTargetMode;
  targetSceneId: 'session' | WorkspaceSceneId;
  /**
   * True when the overlay was not active at the time of the call,
   * meaning the scene will be freshly mounted by React.
   */
  sceneJustOpened: boolean;
}

export interface OpenTargetContext {
  source?: OpenSource;
}

/**
 * Resolve where a content-open intent should land.
 * This is the shared policy entry for cross-scene collaboration.
 */
export function resolveOpenTarget(intent: OpenIntent, context: OpenTargetContext = {}): OpenTargetResolution {
  const { activeSurface } = useWorkspaceSurfaceStore.getState();
  const source = context.source ?? 'default';

  // Base session active: stay in Agentic OS AuxPane tabs
  if (activeSurface.kind === 'agentic-os-home' || activeSurface.kind === 'session') {
    return { mode: 'agent', targetSceneId: 'session', sceneJustOpened: false };
  }

  // Project navigation file tree opens files in file-viewer overlay
  if (intent === 'file' && source === 'project-nav') {
    return { mode: 'project', targetSceneId: 'file-viewer', sceneJustOpened: false };
  }

  // Non-agent surfaces route to their dedicated scenes.
  if (intent === 'terminal') {
    return { mode: 'project', targetSceneId: 'shell', sceneJustOpened: false };
  }

  return { mode: 'project', targetSceneId: 'file-viewer', sceneJustOpened: false };
}

/**
 * Resolve and focus the host scene for an intent.
 *
 * Returns `sceneJustOpened: true` when the target overlay was not active
 * and will therefore be freshly mounted. In that case callers should route
 * follow-up tab events through the pending-tab queue.
 */
export function resolveAndFocusOpenTarget(
  intent: OpenIntent,
  context: OpenTargetContext = {}
): OpenTargetResolution {
  const { activeSurface } = useWorkspaceSurfaceStore.getState();
  const activeSceneId = activeSurface.kind === 'scene' ? activeSurface.sceneId : null;
  const resolution = resolveOpenTarget(intent, context);

  const sceneJustOpened =
    resolution.targetSceneId !== 'session' &&
    activeSceneId !== resolution.targetSceneId;

  if (resolution.targetSceneId !== 'session') {
    openWorkspaceScene(resolution.targetSceneId as WorkspaceSceneId);
  }
  return { ...resolution, sceneJustOpened };
}
