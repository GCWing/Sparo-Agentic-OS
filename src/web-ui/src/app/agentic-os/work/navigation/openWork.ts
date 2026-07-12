import { openMainSession } from '@/flow_chat/services/childSessionPanels';
import { openWorkspaceScene } from '@/app/navigation/workspaceNavigation';
import {
  beginNavigationIntent,
  cancelPendingSessionNavigation,
  commitPendingSessionNavigation,
  getNavigationEpoch,
  type OpenWorkspaceSessionResult,
} from '@/app/navigation/navigationController';
import { useWorkDockStore } from '@/app/stores/workDockStore';
import type { RuntimeInstanceRef, WorkRecord, WorkSurfaceRef } from '../domain/workTypes';
import { resolveWorkSurface } from './workSurfaceResolver';
import { resolveDefaultWorkSurface } from '../domain/workSurface';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import { openProductAppRuntimeForWorkSurface } from '@/app/scenes/apps/product-app-runtime/productAppRuntimeService';
import type { WorkspaceSurfaceContext } from '@/app/navigation/workspaceSurfaceTypes';
import { appScopeFromWorkspacePath, systemAppScope, type AppScope } from '@/shared/types/app-scope';
import type { WorkAppRef } from '../domain/workTypes';
import {
  projectRuntimeScopeFromWorkspacePath,
  systemRuntimeScope,
  type RuntimeScope,
} from '@/shared/types/runtime-scope';
import { useThemeStore } from '@/infrastructure/theme';

interface PendingWorkOpen {
  intent: number;
  navigationEpoch: number;
  promise: Promise<void>;
}

let workOpenIntent = 0;
const pendingWorkOpens = new Map<string, PendingWorkOpen>();

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
    instance.appId === surface.productAppId &&
    instance.productAppSurfaceId === surface.productAppSurfaceId &&
    instance.surfaceId === surface.surfaceId &&
    (!appRef || (
      instance.slotId === appRef.slotId &&
      instance.releaseId === appRef.releaseId &&
      instance.configRevision === appRef.configRevision
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

async function performOpenWork(
  work: WorkRecord,
  isNavigationCurrent: () => boolean,
  navigationEpoch: number,
): Promise<void> {
  if (!isNavigationCurrent()) return;
  const defaultSurface = resolveDefaultWorkSurface(work);
  const surface = resolveWorkSurface(work, {
    getSessionRecency: (sessionId) => {
      const session = flowChatStore.getState().sessions.get(sessionId);
      return session?.lastActiveAt ?? session?.createdAt;
    },
    isLinkedSessionCompatible: (sessionId) => {
      if (defaultSurface.kind !== 'application_surface') return false;
      const session = flowChatStore.getState().sessions.get(sessionId);
      if (!session) return undefined;
      const binding = session.customMetadata?.productAppRuntime;
      if (!binding || binding.appId !== defaultSurface.productAppId) return false;
      const boundWorkId = binding.runtimeContext?.workId;
      return !boundWorkId || boundWorkId === work.id;
    },
  });
  const runtimeScope = runtimeScopeFromWork(work);
  const openSurface = (target: WorkSurfaceRef) => openWorkSurface(target, work.id, {
    runtimeScope,
    productAppRef: productAppRefForSurface(work, target),
    runtimeInstance: runtimeInstanceForSurface(work, target),
    scope: work.scope.kind === 'workspace'
      ? appScopeFromWorkspacePath(work.scope.workspacePath) ?? systemAppScope()
      : systemAppScope(),
    isNavigationCurrent,
    navigationEpoch,
  });
  const result = await openSurface(surface);

  if (result === 'missing' && surface.kind === 'agent_session' && isNavigationCurrent()) {
    if (defaultSurface.kind === 'application_surface') {
      await openSurface(defaultSurface);
    }
  }
}

export async function openWork(work: WorkRecord): Promise<void> {
  const intent = ++workOpenIntent;
  const existing = pendingWorkOpens.get(work.id);
  if (existing && existing.navigationEpoch === getNavigationEpoch()) {
    // Re-selecting the same in-flight Work joins its preparation instead of
    // starting another catalog/runtime resolution chain.
    existing.intent = intent;
    return existing.promise;
  }

  const navigationEpoch = beginNavigationIntent();
  const pending: PendingWorkOpen = {
    intent,
    navigationEpoch,
    promise: Promise.resolve(),
  };
  const isNavigationCurrent = () => (
    pending.intent === workOpenIntent &&
    pending.navigationEpoch === getNavigationEpoch()
  );

  pending.promise = performOpenWork(work, isNavigationCurrent, navigationEpoch).finally(() => {
    if (pendingWorkOpens.get(work.id) === pending) {
      pendingWorkOpens.delete(work.id);
    }
  });
  pendingWorkOpens.set(work.id, pending);
  return pending.promise;
}

export async function openWorkSurface(
  surface: WorkSurfaceRef,
  fallbackWorkId: string,
  options: {
    scope?: AppScope | null;
    runtimeScope?: RuntimeScope | null;
    productAppRef?: WorkAppRef | null;
    runtimeInstance?: RuntimeInstanceRef | null;
    isNavigationCurrent?: () => boolean;
    navigationEpoch?: number;
  } = {}
): Promise<OpenWorkspaceSessionResult> {
  if (options.isNavigationCurrent?.() === false) return 'superseded';
  const context: WorkspaceSurfaceContext = { kind: 'work', workId: fallbackWorkId };

  switch (surface.kind) {
    case 'work_session':
    case 'agent_session':
      return openMainSession(surface.sessionId, {
        context,
        commitPendingSurface: true,
        navigationEpoch: options.navigationEpoch,
      });
    case 'work_center':
      openWorkInCenter(surface.workId);
      return 'opened';
    case 'application_surface':
      if (!options.productAppRef) {
        throw new Error(`Work ${fallbackWorkId} has no immutable App binding for ${surface.productAppId}`);
      }
      if (options.navigationEpoch !== undefined) {
        const committed = commitPendingSessionNavigation(
          `pending-work:${fallbackWorkId}`,
          {
            context,
            navigationEpoch: options.navigationEpoch,
          },
        );
        if (!committed) return 'superseded';
      }
      try {
        await openProductAppRuntimeForWorkSurface({
          workId: fallbackWorkId,
          slotId: options.productAppRef.slotId,
          appId: surface.productAppId,
          releaseId: options.productAppRef.releaseId,
          configRevision: options.productAppRef.configRevision,
          runtimeInstanceId: options.runtimeInstance?.id,
          productAppSurfaceId: surface.productAppSurfaceId,
          surfaceId: surface.surfaceId,
        }, {
          scope: options.scope ?? systemAppScope(),
          context,
          theme: useThemeStore.getState().currentTheme?.type ?? 'dark',
          navigationEpoch: options.navigationEpoch,
          isNavigationCurrent: options.isNavigationCurrent,
        });
        return 'opened';
      } finally {
        if (options.navigationEpoch !== undefined) {
          cancelPendingSessionNavigation(options.navigationEpoch);
        }
      }
    case 'os_agent_home':
      openWorkInCenter(fallbackWorkId);
      return 'opened';
    default:
      openWorkInCenter(fallbackWorkId);
      return 'opened';
  }
}
