import type { WorkspaceSceneId } from './workspaceSceneTypes';
import { appScopeIdentity } from '@/shared/types/app-scope';
import type { AppScope } from '@/shared/types/app-scope';
import { runtimeScopeIdentity, systemRuntimeScope, type RuntimeScope } from '@/shared/types/runtime-scope';
import type { ProductAppRuntimeContext } from '@/shared/types/product-app-runtime';

export type WorkspaceSurfaceContext =
  | { kind: 'work'; workId: string };

export type WorkspaceSurface =
  | { kind: 'agentic-os-home'; scope: RuntimeScope }
  | {
      kind: 'scene';
      sceneId: WorkspaceSceneId;
      scope: RuntimeScope;
      appScope?: AppScope | null;
      runtimeContext?: ProductAppRuntimeContext | null;
    }
  | { kind: 'session'; sessionId: string };

function runtimeContextIdentity(context?: ProductAppRuntimeContext | null): string {
  return context ? `${context.workId}:${context.runtimeInstanceId}` : '';
}

export function isSameWorkspaceSurface(a: WorkspaceSurface, b: WorkspaceSurface): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'agentic-os-home':
      return (
        runtimeScopeIdentity(a.scope) ===
          runtimeScopeIdentity((b as Extract<WorkspaceSurface, { kind: 'agentic-os-home' }>).scope)
      );
    case 'scene':
      return (
        a.sceneId === (b as Extract<WorkspaceSurface, { kind: 'scene' }>).sceneId &&
        runtimeScopeIdentity(a.scope) ===
          runtimeScopeIdentity((b as Extract<WorkspaceSurface, { kind: 'scene' }>).scope) &&
        appScopeIdentity(a.appScope) ===
          appScopeIdentity((b as Extract<WorkspaceSurface, { kind: 'scene' }>).appScope) &&
        runtimeContextIdentity(a.runtimeContext) ===
          runtimeContextIdentity((b as Extract<WorkspaceSurface, { kind: 'scene' }>).runtimeContext)
      );
    case 'session':
      return a.sessionId === (b as Extract<WorkspaceSurface, { kind: 'session' }>).sessionId;
  }
}

export function createAgenticOsHomeSurface(): Extract<WorkspaceSurface, { kind: 'agentic-os-home' }> {
  return { kind: 'agentic-os-home', scope: systemRuntimeScope() };
}
