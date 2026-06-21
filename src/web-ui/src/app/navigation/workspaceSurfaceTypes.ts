import type { WorkspaceSceneId } from './workspaceSceneTypes';

export type WorkspaceSurfaceContext =
  | { kind: 'work'; workId: string };

export type WorkspaceSurface =
  | { kind: 'agentic-os-home'; agenticOsSessionId: string | null }
  | { kind: 'scene'; sceneId: WorkspaceSceneId; workspacePath?: string | null }
  | { kind: 'session'; sessionId: string };

export function isSameWorkspaceSurface(a: WorkspaceSurface, b: WorkspaceSurface): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'agentic-os-home':
      return a.agenticOsSessionId === (b as Extract<WorkspaceSurface, { kind: 'agentic-os-home' }>).agenticOsSessionId;
    case 'scene':
      return (
        a.sceneId === (b as Extract<WorkspaceSurface, { kind: 'scene' }>).sceneId &&
        a.workspacePath ===
          (b as Extract<WorkspaceSurface, { kind: 'scene' }>).workspacePath
      );
    case 'session':
      return a.sessionId === (b as Extract<WorkspaceSurface, { kind: 'session' }>).sessionId;
  }
}
