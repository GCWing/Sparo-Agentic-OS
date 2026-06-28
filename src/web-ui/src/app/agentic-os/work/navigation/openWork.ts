import { openMainSession } from '@/flow_chat/services/childSessionPanels';
import { openWorkspaceScene } from '@/app/navigation/workspaceNavigation';
import { useWorkDockStore } from '@/app/stores/workDockStore';
import type { WorkRecord, WorkSurfaceRef } from '../domain/workTypes';
import { resolveWorkSurface } from './workSurfaceResolver';
import { openProductAppSurface } from '@/app/scenes/apps/surface-component/surfaceComponentWorkbenchService';
import type { WorkspaceSurfaceContext } from '@/app/navigation/workspaceSurfaceTypes';
import { appScopeFromWorkspacePath, systemAppScope, type AppScope } from '@/shared/types/app-scope';
import type { WorkAppRef } from '../domain/workTypes';
import {
  projectRuntimeScopeFromWorkspacePath,
  systemRuntimeScope,
  type RuntimeScope,
} from '@/shared/types/runtime-scope';

function runtimeScopeFromWork(work: WorkRecord): RuntimeScope {
  return work.scope.kind === 'workspace'
    ? projectRuntimeScopeFromWorkspacePath(work.scope.workspacePath) ?? systemRuntimeScope()
    : systemRuntimeScope();
}

export function openWorkCenterHome(): void {
  const store = useWorkDockStore.getState();
  store.setWorkCenterScope({ kind: 'open' });
  store.setWorkCenterWorkspaceFilter({ kind: 'all' });
  store.setWorkCenterAppFilter({ kind: 'all' });
  store.setWorkCenterGrouping('priority');
  store.setWorkCenterSelectedWorkId(null);
  openWorkspaceScene('work-center');
}

export function openWorkInCenter(workId: string): void {
  const store = useWorkDockStore.getState();
  store.setWorkCenterScope({ kind: 'all' });
  store.setWorkCenterWorkspaceFilter({ kind: 'all' });
  store.setWorkCenterAppFilter({ kind: 'all' });
  store.setWorkCenterGrouping('priority');
  store.setWorkCenterSelectedWorkId(workId);
  openWorkspaceScene('work-center');
}

export function openWorkCenterForApp(app: WorkAppRef): void {
  const store = useWorkDockStore.getState();
  store.setWorkCenterScope({ kind: 'open' });
  store.setWorkCenterWorkspaceFilter({ kind: 'all' });
  store.setWorkCenterAppFilter({ kind: 'app', app });
  store.setWorkCenterGrouping('priority');
  store.setWorkCenterSelectedWorkId(null);
  openWorkspaceScene('work-center');
}

export async function openWork(work: WorkRecord): Promise<void> {
  const surface = resolveWorkSurface(work);
  const runtimeScope = runtimeScopeFromWork(work);
  await openWorkSurface(surface, work.id, {
    runtimeScope,
    scope: work.scope.kind === 'workspace'
      ? appScopeFromWorkspacePath(work.scope.workspacePath) ?? systemAppScope()
      : systemAppScope(),
  });
}

export async function openWorkSurface(
  surface: WorkSurfaceRef,
  fallbackWorkId: string,
  options: { scope?: AppScope | null; runtimeScope?: RuntimeScope | null } = {}
): Promise<void> {
  const context: WorkspaceSurfaceContext = { kind: 'work', workId: fallbackWorkId };

  switch (surface.kind) {
    case 'work_session':
    case 'agent_session':
      await openMainSession(surface.sessionId, { context });
      return;
    case 'work_center':
      openWorkInCenter(surface.workId);
      return;
    case 'application_surface':
      await openProductAppSurface({
        productAppId: surface.productAppId,
        surfaceComponentId: surface.surfaceComponentId,
        surfaceId: surface.surfaceId,
      }, {
        scope: options.scope ?? systemAppScope(),
        context,
      });
      return;
    case 'os_agent_home':
      openWorkInCenter(fallbackWorkId);
      return;
    default:
      openWorkInCenter(fallbackWorkId);
  }
}
