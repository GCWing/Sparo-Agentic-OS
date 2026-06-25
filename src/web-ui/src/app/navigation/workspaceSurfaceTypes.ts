import type { WorkspaceSceneId } from './workspaceSceneTypes';
import { appScopeIdentity } from '@/shared/types/app-scope';
import type { AppScope } from '@/shared/types/app-scope';
import { runtimeScopeIdentity, type RuntimeScope } from '@/shared/types/runtime-scope';

export type WorkspaceSurfaceContext =
  | { kind: 'work'; workId: string };

export type WorkspaceSurface =
  | { kind: 'agentic-os-home'; agenticOsSessionId: string | null; scope: RuntimeScope }
  | { kind: 'scene'; sceneId: WorkspaceSceneId; scope: RuntimeScope; appScope?: AppScope | null }
  | { kind: 'session'; sessionId: string };

export function isSameWorkspaceSurface(a: WorkspaceSurface, b: WorkspaceSurface): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'agentic-os-home':
      return (
        a.agenticOsSessionId ===
          (b as Extract<WorkspaceSurface, { kind: 'agentic-os-home' }>).agenticOsSessionId &&
        runtimeScopeIdentity(a.scope) ===
          runtimeScopeIdentity((b as Extract<WorkspaceSurface, { kind: 'agentic-os-home' }>).scope)
      );
    case 'scene':
      return (
        a.sceneId === (b as Extract<WorkspaceSurface, { kind: 'scene' }>).sceneId &&
        runtimeScopeIdentity(a.scope) ===
          runtimeScopeIdentity((b as Extract<WorkspaceSurface, { kind: 'scene' }>).scope) &&
        appScopeIdentity(a.appScope) ===
          appScopeIdentity((b as Extract<WorkspaceSurface, { kind: 'scene' }>).appScope)
      );
    case 'session':
      return a.sessionId === (b as Extract<WorkspaceSurface, { kind: 'session' }>).sessionId;
  }
}
