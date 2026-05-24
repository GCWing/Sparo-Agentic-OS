import type { WorkspaceSceneId } from './workspaceSceneTypes';

export type WorkspaceSurface =
  | { kind: 'dispatcher-home'; dispatcherSessionId: string | null }
  | { kind: 'scene'; sceneId: WorkspaceSceneId; workspacePath?: string | null }
  | { kind: 'session'; sessionId: string };

export function isSameWorkspaceSurface(a: WorkspaceSurface, b: WorkspaceSurface): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'dispatcher-home':
      return a.dispatcherSessionId === (b as Extract<WorkspaceSurface, { kind: 'dispatcher-home' }>).dispatcherSessionId;
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
