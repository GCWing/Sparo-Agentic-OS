import type { WorkspaceSceneId } from './workspaceSceneTypes';

export type WorkspaceSurface =
  | { kind: 'dispatcher-home'; dispatcherSessionId: string | null }
  | { kind: 'scene'; sceneId: WorkspaceSceneId }
  | { kind: 'session'; sessionId: string };

export type WorkspaceSurfaceTransitionKind =
  | 'open-from-home'
  | 'return-home'
  | 'peer-switch'
  | 'replace-within-kind'
  | 'none';

export function isSameWorkspaceSurface(a: WorkspaceSurface, b: WorkspaceSurface): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'dispatcher-home':
      return a.dispatcherSessionId === (b as Extract<WorkspaceSurface, { kind: 'dispatcher-home' }>).dispatcherSessionId;
    case 'scene':
      return a.sceneId === (b as Extract<WorkspaceSurface, { kind: 'scene' }>).sceneId;
    case 'session':
      return a.sessionId === (b as Extract<WorkspaceSurface, { kind: 'session' }>).sessionId;
  }
}

export function resolveWorkspaceSurfaceTransition(
  previous: WorkspaceSurface,
  next: WorkspaceSurface
): WorkspaceSurfaceTransitionKind {
  if (isSameWorkspaceSurface(previous, next)) return 'none';

  if (previous.kind === 'dispatcher-home' && next.kind !== 'dispatcher-home') {
    return 'open-from-home';
  }

  if (previous.kind !== 'dispatcher-home' && next.kind === 'dispatcher-home') {
    return 'return-home';
  }

  if (previous.kind === next.kind) {
    return 'replace-within-kind';
  }

  return 'peer-switch';
}

export function workspaceTransitionToSceneTransition(
  kind: WorkspaceSurfaceTransitionKind
): 'open' | 'return' | 'switch' | null {
  switch (kind) {
    case 'open-from-home':
      return 'open';
    case 'return-home':
      return 'return';
    case 'peer-switch':
    case 'replace-within-kind':
      return 'switch';
    case 'none':
      return null;
  }
}
