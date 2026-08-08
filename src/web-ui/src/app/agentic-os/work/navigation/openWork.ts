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
import type { WorkLocator, WorkRecord, WorkSurfaceRef } from '../domain/workTypes';
import { resolveWorkSurface } from './workSurfaceResolver';
import { resolveDefaultWorkSurface } from '../domain/workSurface';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import { openProductAppRuntimeForWorkSurface } from '@/app/scenes/apps/product-app-runtime/productAppRuntimeService';
import type { WorkspaceSurfaceContext } from '@/app/navigation/workspaceSurfaceTypes';
import { appScopeFromWorkScope, systemAppScope, type AppScope } from '@/shared/types/app-scope';
import type { WorkAppRef } from '../domain/workTypes';
import {
  runtimeScopeFromAppScope,
  systemRuntimeScope,
  type RuntimeScope,
} from '@/shared/types/runtime-scope';
import { useThemeStore } from '@/infrastructure/theme';
import { productAppRuntimeAPI, type ProductAppWorkCompatibility } from '@/infrastructure/api/service-api/ProductAppRuntimeAPI';
import { i18nService } from '@/infrastructure/i18n';
import { notificationService } from '@/shared/notification-system';
import { useWorkspaceSurfaceStore } from '@/app/navigation/workspaceSurfaceStore';

interface PendingWorkOpen {
  intent: number;
  navigationEpoch: number;
  promise: Promise<void>;
}

let workOpenIntent = 0;
const pendingWorkOpens = new Map<string, PendingWorkOpen>();

function compatibilityMessage(result: ProductAppWorkCompatibility): string {
  switch (result.status) {
    case 'versionIncompatible':
      return i18nService.t('scenes/work-center:compatibility.versionIncompatible', {
        appId: result.appId,
        createdWithVersion: result.createdWithVersion ?? result.createdWithReleaseId,
        installedVersion: result.installedVersion ?? result.installedReleaseId ?? i18nService.t('scenes/work-center:compatibility.unknown'),
        workDataSchemaVersion: result.workDataSchemaVersion,
        installedDataSchemaVersion: result.installedDataSchemaVersion ?? i18nService.t('scenes/work-center:compatibility.unknown'),
      });
    case 'appDisabled':
      return i18nService.t('scenes/work-center:compatibility.appDisabled', { appId: result.appId });
    case 'appSelectionChanged':
      return i18nService.t('scenes/work-center:compatibility.appSelectionChanged', {
        appId: result.appId,
        installedAppId: result.installedAppId ?? i18nService.t('scenes/work-center:compatibility.unknown'),
      });
    case 'appUnavailable':
      return i18nService.t('scenes/work-center:compatibility.appUnavailable', { appId: result.appId });
    case 'compatible':
      return '';
  }
}

async function ensureProductAppWorkIsCompatible(work: WorkRecord): Promise<boolean> {
  const productApp = work.subject.kind === 'app' && work.subject.app.kind === 'product_app'
    ? work.subject.app
    : work.appRefs.find(({ app }) => app.kind === 'product_app')?.app;
  if (!productApp) return true;
  const compatibility = await productAppRuntimeAPI.prepareProductAppWork({
    scope: work.scope,
    workId: work.id,
  });
  if (compatibility.status === 'compatible') return true;
  notificationService.warning(compatibilityMessage(compatibility), { duration: 9000 });
  openWorkInCenter(work.id);
  return false;
}

function runtimeScopeFromWork(work: WorkRecord): RuntimeScope {
  return work.scope.kind === 'workspace'
    ? runtimeScopeFromAppScope(appScopeFromWorkScope(work.scope, work.workspacePath))
    : systemRuntimeScope('os_agent');
}

function productAppRefForSurface(work: WorkRecord, surface: WorkSurfaceRef): WorkAppRef | null {
  if (surface.kind !== 'application_surface') return null;
  if (work.subject.kind === 'app' && work.subject.app.appId === surface.productAppId) {
    return work.subject.app;
  }
  return work.appRefs.find(relation => relation.app.appId === surface.productAppId)?.app ?? null;
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
  if (!await ensureProductAppWorkIsCompatible(work) || !isNavigationCurrent()) return;
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
      const boundWorkId = binding.runtimeContext?.workLocator.workId;
      return !boundWorkId || boundWorkId === work.id;
    },
  });
  const runtimeScope = runtimeScopeFromWork(work);
  const openSurface = (target: WorkSurfaceRef) => openWorkSurface(target, {
    scope: work.scope,
    workId: work.id,
  }, {
    runtimeScope,
    productAppRef: productAppRefForSurface(work, target),
    scope: appScopeFromWorkScope(work.scope, work.workspacePath),
    isNavigationCurrent,
    navigationEpoch,
  });
  // Composite sessions are rebound through the current Application Surface
  // runtime before navigation. This updates their runtime metadata and never
  // reuses a host created by the Work's historical Release.
  const targetSurface = surface.kind === 'agent_session'
    && defaultSurface.kind === 'application_surface'
    ? defaultSurface
    : surface;
  const result = await openSurface(targetSurface);

  if (result === 'missing' && targetSurface.kind === 'agent_session' && isNavigationCurrent()) {
    if (defaultSurface.kind === 'application_surface') {
      await openSurface(defaultSurface);
    }
  }
}

export async function openWork(work: WorkRecord): Promise<void> {
  const existing = pendingWorkOpens.get(work.id);
  if (existing && existing.navigationEpoch === getNavigationEpoch()) {
    // Re-selecting the same in-flight Work joins its preparation instead of
    // starting another catalog/runtime resolution chain.
    const intent = ++workOpenIntent;
    existing.intent = intent;
    return existing.promise;
  }

  const activeContext = useWorkspaceSurfaceStore.getState().surfaceContext;
  if (activeContext?.kind === 'work' && activeContext.workId === work.id) {
    return;
  }

  const intent = ++workOpenIntent;
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
  workLocator: WorkLocator,
  options: {
    scope?: AppScope | null;
    runtimeScope?: RuntimeScope | null;
    productAppRef?: WorkAppRef | null;
    isNavigationCurrent?: () => boolean;
    navigationEpoch?: number;
  } = {}
): Promise<OpenWorkspaceSessionResult> {
  if (options.isNavigationCurrent?.() === false) return 'superseded';
  const fallbackWorkId = workLocator.workId;
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
          workLocator,
          slotId: options.productAppRef.slotId,
          appId: surface.productAppId,
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
