import { openMainSession } from '@/flow_chat/services/childSessionPanels';
import { openWorkspaceScene } from '@/app/navigation/workspaceNavigation';
import { useWorkDockStore } from '@/app/stores/workDockStore';
import type { WorkRecord, WorkSurfaceRef } from '../domain/workTypes';
import { resolveWorkSurface } from './workSurfaceResolver';
import { openLiveApp } from '@/app/scenes/apps/live-app/liveAppWorkbenchService';

export function openWorkCenterHome(): void {
  const store = useWorkDockStore.getState();
  store.setWorkCenterScope({ kind: 'open' });
  store.setWorkCenterWorkspaceFilter({ kind: 'all' });
  store.setWorkCenterGrouping('priority');
  store.setWorkCenterSelectedWorkId(null);
  openWorkspaceScene('work-center');
}

export function openWorkInCenter(workId: string): void {
  const store = useWorkDockStore.getState();
  store.setWorkCenterScope({ kind: 'all' });
  store.setWorkCenterWorkspaceFilter({ kind: 'all' });
  store.setWorkCenterGrouping('priority');
  store.setWorkCenterSelectedWorkId(workId);
  openWorkspaceScene('work-center');
}

export async function openWork(work: WorkRecord): Promise<void> {
  const surface = resolveWorkSurface(work);
  await openWorkSurface(surface, work.id, {
    workspacePath: work.scope.kind === 'workspace' ? work.scope.workspacePath : undefined,
  });
}

export async function openWorkSurface(
  surface: WorkSurfaceRef,
  fallbackWorkId: string,
  options: { workspacePath?: string | null } = {}
): Promise<void> {
  switch (surface.kind) {
    case 'work_session':
    case 'agent_session':
      await openMainSession(surface.sessionId);
      return;
    case 'live_app':
      await openLiveApp(surface.appId, {
        workspacePath: options.workspacePath,
      });
      return;
    case 'work_center':
      openWorkInCenter(surface.workId);
      return;
    case 'application_surface':
      openWorkspaceScene('apps');
      return;
    case 'os_agent_home':
      openWorkInCenter(fallbackWorkId);
      return;
    default:
      openWorkInCenter(fallbackWorkId);
  }
}
