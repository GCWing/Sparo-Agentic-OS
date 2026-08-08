import type { WorkspaceSceneId } from '@/app/navigation/workspaceSceneTypes';
import { openWorkspaceScene } from '@/app/navigation/workspaceNavigation';
import { useWorkspaceSurfaceStore } from '@/app/navigation/workspaceSurfaceStore';
import type { RuntimeScope } from '@/shared/types/runtime-scope';

export type OpenIntent = 'file' | 'terminal';
export type OpenTargetMode = 'agent' | 'project';
export type OpenSource = 'default' | 'project-nav';

export interface OpenTargetResolution {
  mode: OpenTargetMode;
  targetSceneId: 'session' | WorkspaceSceneId;
}

export interface OpenTargetContext {
  source?: OpenSource;
  scope?: RuntimeScope | null;
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
    return { mode: 'agent', targetSceneId: 'session' };
  }

  // Project navigation file tree opens files in file-viewer overlay
  if (intent === 'file' && source === 'project-nav') {
    return { mode: 'project', targetSceneId: 'file-viewer' };
  }

  // Non-agent surfaces route to their dedicated scenes.
  if (intent === 'terminal') {
    return { mode: 'project', targetSceneId: 'shell' };
  }

  return { mode: 'project', targetSceneId: 'file-viewer' };
}

/**
 * Resolve and focus the host scene for an intent.
 *
 * Canvas stores exist independently of React mounting, so callers can write to
 * the resolved target immediately after navigation.
 */
export function resolveAndFocusOpenTarget(
  intent: OpenIntent,
  context: OpenTargetContext = {}
): OpenTargetResolution {
  const { activeSurface } = useWorkspaceSurfaceStore.getState();
  const resolution = resolveOpenTarget(intent, context);
  const targetScope = context.scope ?? (activeSurface.kind === 'scene' ? activeSurface.scope : undefined);

  if (resolution.targetSceneId !== 'session') {
    openWorkspaceScene(resolution.targetSceneId as WorkspaceSceneId, {
      scope: targetScope,
    });
  }
  return resolution;
}
