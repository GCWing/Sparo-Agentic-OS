import { openMainSession } from '@/flow_chat/services/childSessionPanels';
import { openWorkspaceScene } from '@/app/navigation/workspaceNavigation';
import { useWorkDockStore } from '@/app/stores/workDockStore';
import type { RuntimeInstanceRef, WorkRecord, WorkSurfaceRef } from '../domain/workTypes';
import { resolveWorkSurface } from './workSurfaceResolver';
import { openProductAppRuntimeForWorkSurface } from '@/app/scenes/apps/product-app-runtime/productAppRuntimeService';
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

function productAppRefForSurface(work: WorkRecord, surface: WorkSurfaceRef): WorkAppRef | null {
  if (surface.kind !== 'application_surface') return null;
  if (work.subject.kind === 'app' && work.subject.app.appId === surface.productAppId) {
    return work.subject.app;
  }
  return work.appRefs.find(relation => relation.app.appId === surface.productAppId)?.app ?? null;
}

function runtimeInstanceForSurface(work: WorkRecord, surface: WorkSurfaceRef): RuntimeInstanceRef | null {
  if (surface.kind !== 'application_surface') return null;
  const appRef = productAppRefForSurface(work, surface);
  return work.runtimeInstances.find(instance =>
    instance.productAppId === surface.productAppId &&
    instance.productAppSurfaceId === surface.productAppSurfaceId &&
    instance.surfaceId === surface.surfaceId &&
    (!appRef || (
      instance.appVersion === appRef.appVersion &&
      instance.componentLockDigest === appRef.componentLockDigest
    ))
  ) ?? null;
}

export function openWorkCenterHome(): void {
  const store = useWorkDockStore.getState();
  store.setWorkCenterScope({ kind: 'open' });
  store.setWorkCenterWorkspaceFilter({ kind: 'all' });
  store.setWorkCenterAppFilter({ kind: 'all' });
  store.setWorkCenterGrouping('priority');
  store.setWorkCenterSelectedWorkId(null);
  store.setWorkCenterSelectedArtifactId(null);
  openWorkspaceScene('work-center');
}

export function openWorkInCenter(workId: string): void {
  const store = useWorkDockStore.getState();
  store.setWorkCenterScope({ kind: 'all' });
  store.setWorkCenterWorkspaceFilter({ kind: 'all' });
  store.setWorkCenterAppFilter({ kind: 'all' });
  store.setWorkCenterGrouping('priority');
  store.setWorkCenterSelectedWorkId(workId);
  store.setWorkCenterSelectedArtifactId(null);
  openWorkspaceScene('work-center');
}

export function openArtifactInCenter(workId: string, artifactId: string): void {
  const store = useWorkDockStore.getState();
  store.setWorkCenterScope({ kind: 'all' });
  store.setWorkCenterWorkspaceFilter({ kind: 'all' });
  store.setWorkCenterAppFilter({ kind: 'all' });
  store.setWorkCenterGrouping('priority');
  store.setWorkCenterSelectedWorkId(workId);
  store.setWorkCenterSelectedArtifactId(artifactId);
  openWorkspaceScene('work-center');
}

export function openWorkCenterForApp(app: WorkAppRef): void {
  const store = useWorkDockStore.getState();
  store.setWorkCenterScope({ kind: 'open' });
  store.setWorkCenterWorkspaceFilter({ kind: 'all' });
  store.setWorkCenterAppFilter({ kind: 'app', app });
  store.setWorkCenterGrouping('priority');
  store.setWorkCenterSelectedWorkId(null);
  store.setWorkCenterSelectedArtifactId(null);
  openWorkspaceScene('work-center');
}

export async function openWork(work: WorkRecord): Promise<void> {
  const surface = resolveWorkSurface(work);
  const runtimeScope = runtimeScopeFromWork(work);
  await openWorkSurface(surface, work.id, {
    runtimeScope,
    productAppRef: productAppRefForSurface(work, surface),
    runtimeInstance: runtimeInstanceForSurface(work, surface),
    scope: work.scope.kind === 'workspace'
      ? appScopeFromWorkspacePath(work.scope.workspacePath) ?? systemAppScope()
      : systemAppScope(),
  });
}

export async function openWorkSurface(
  surface: WorkSurfaceRef,
  fallbackWorkId: string,
  options: {
    scope?: AppScope | null;
    runtimeScope?: RuntimeScope | null;
    productAppRef?: WorkAppRef | null;
    runtimeInstance?: RuntimeInstanceRef | null;
  } = {}
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
      await openProductAppRuntimeForWorkSurface({
        workId: fallbackWorkId,
        productAppId: surface.productAppId,
        runtimeInstanceId: options.runtimeInstance?.id,
        productAppVersion: options.productAppRef?.appVersion,
        componentLockDigest: options.productAppRef?.componentLockDigest,
        productAppSurfaceId: surface.productAppSurfaceId,
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
