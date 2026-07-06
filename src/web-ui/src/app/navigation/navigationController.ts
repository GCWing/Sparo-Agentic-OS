import type { WorkspaceSceneId } from './workspaceSceneTypes';
import {
  selectFocusedSessionId,
  useWorkspaceSurfaceStore,
  type WorkspaceSurfaceHistoryMode,
} from './workspaceSurfaceStore';
import type { WorkspaceSurfaceContext } from './workspaceSurfaceTypes';
import { createAgenticOsHomeSurface } from './workspaceSurfaceTypes';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import { syncSessionToModernStore } from '@/flow_chat/services/storeSync';
import {
  getAgenticOsSessionDescriptor,
  isSystemAgenticOsSession,
} from '@/flow_chat/domain/sessionDescriptor';
import type { Session } from '@/flow_chat/types/flow-chat';
import { resolveSessionTypeDefinitionForDescriptor } from '@/app/session-profiles';
import { sessionAPI } from '@/infrastructure/api/service-api/SessionAPI';
import { workspaceManager } from '@/infrastructure/services/business/workspaceManager';
import {
  projectRuntimeScopeFromWorkspacePath,
  runtimeScopeFromAppScope,
  systemRuntimeScope,
  type RuntimeScope,
} from '@/shared/types/runtime-scope';
import type { AppScope } from '@/shared/types/app-scope';
import type { ProductAppRuntimeContext } from '@/shared/types/product-app-runtime';
import type { SessionStorageScope } from '@/shared/types/session-history';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('NavigationController');

let navEpoch = 0;

export function getNavigationEpoch(): number {
  return navEpoch;
}

export interface OpenWorkspaceSceneOptions {
  scope?: RuntimeScope | null;
  workspacePath?: string | null;
  appScope?: AppScope | null;
  context?: WorkspaceSurfaceContext | null;
  runtimeContext?: ProductAppRuntimeContext | null;
  historyMode?: WorkspaceSurfaceHistoryMode;
}

export interface OpenWorkspaceSessionOptions {
  context?: WorkspaceSurfaceContext | null;
}

function resolveSceneScope(options: OpenWorkspaceSceneOptions): RuntimeScope {
  if (options.scope) {
    return options.scope;
  }
  if (options.appScope) {
    return runtimeScopeFromAppScope(options.appScope);
  }
  if (options.workspacePath === null) {
    return systemRuntimeScope();
  }
  return projectRuntimeScopeFromWorkspacePath(options.workspacePath) ?? systemRuntimeScope();
}

function findLatestAgenticOsSessionId(): string | null {
  return Array.from(flowChatStore.getState().sessions.values())
    .filter((session) => isSystemAgenticOsSession(session.descriptor))
    .sort(
      (a, b) =>
        (b.lastActiveAt ?? b.createdAt ?? 0) - (a.lastActiveAt ?? a.createdAt ?? 0)
    )[0]?.sessionId ?? null;
}

async function loadSessionMetadataAttempt(
  sessionId: string,
  workspacePath: string | undefined,
  storageScope: SessionStorageScope
): Promise<Session | null> {
  try {
    const metadata = await sessionAPI.loadSessionMetadata(sessionId, workspacePath, storageScope);
    if (!metadata) {
      return null;
    }
    await flowChatStore.hydrateWorkspaceSessionsMetadata(
      [metadata],
      metadata.workspacePath || workspacePath || '',
      metadata.storageScope || storageScope,
    );
    return flowChatStore.getState().sessions.get(sessionId) ?? null;
  } catch (error) {
    log.debug('Session metadata load attempt failed', { sessionId, workspacePath, storageScope, error });
    return null;
  }
}

async function ensureSessionInStore(sessionId: string): Promise<Session | null> {
  const existing = flowChatStore.getState().sessions.get(sessionId);
  if (existing) {
    return existing;
  }

  const agenticOsSession = await loadSessionMetadataAttempt(sessionId, undefined, 'agentic_os');
  if (agenticOsSession) {
    return agenticOsSession;
  }

  const openedWorkspaces = Array.from(workspaceManager.getState().openedWorkspaces.values());
  for (const workspace of openedWorkspaces) {
    const workspaceSession = await loadSessionMetadataAttempt(
      sessionId,
      workspace.rootPath,
      'workspace',
    );
    if (workspaceSession) {
      return workspaceSession;
    }
  }

  log.warn('Session not found in store or on disk', { sessionId });
  return null;
}

function commitSessionSurface(
  session: Session,
  options: OpenWorkspaceSessionOptions = {}
): void {
  const sessionType = resolveSessionTypeDefinitionForDescriptor(session.descriptor);
  const surfacePolicy = sessionType.lifecycle.defaultSurface;

  if (surfacePolicy === 'agentic-os-home') {
    useWorkspaceSurfaceStore.getState().openSurface(createAgenticOsHomeSurface(), {
      context: options.context,
      currentOsSessionId: session.sessionId,
    });
    return;
  }

  if (surfacePolicy === 'session') {
    useWorkspaceSurfaceStore.getState().openSurface(
      { kind: 'session', sessionId: session.sessionId },
      { context: options.context },
    );
    return;
  }

  log.warn('Session surface policy not handled for navigation', {
    sessionId: session.sessionId,
    surfacePolicy,
  });
}

async function settleSessionActivation(sessionId: string): Promise<void> {
  flowChatStore.switchSession(sessionId);
  syncSessionToModernStore(sessionId);
  const { flowChatManager } = await import('@/flow_chat/services/FlowChatManager');
  await flowChatManager.activateSessionData(sessionId);
}

export function openScene(
  sceneId: WorkspaceSceneId,
  options: OpenWorkspaceSceneOptions = {}
): void {
  ++navEpoch;
  useWorkspaceSurfaceStore.getState().openSurface({
    kind: 'scene',
    sceneId,
    scope: resolveSceneScope(options),
    appScope: options.appScope,
    runtimeContext: options.runtimeContext,
  }, {
    context: options.context,
    historyMode: options.historyMode,
  });
}

export function goBackScene(): boolean {
  ++navEpoch;
  return useWorkspaceSurfaceStore.getState().goBackScene();
}

export function openSceneHistoryEntry(index: number): boolean {
  ++navEpoch;
  return useWorkspaceSurfaceStore.getState().openSceneHistoryEntry(index);
}

export async function openSession(
  sessionId: string,
  options: OpenWorkspaceSessionOptions = {}
): Promise<void> {
  const trimmedSessionId = sessionId.trim();
  if (!trimmedSessionId) {
    return;
  }

  const epoch = ++navEpoch;
  const currentFocusedId = selectFocusedSessionId(useWorkspaceSurfaceStore.getState());

  const session = await ensureSessionInStore(trimmedSessionId);
  if (epoch !== navEpoch) {
    return;
  }
  if (!session) {
    return;
  }

  if (currentFocusedId === trimmedSessionId) {
    syncSessionToModernStore(trimmedSessionId);
    void import('@/flow_chat/services/FlowChatManager').then(({ flowChatManager }) =>
      flowChatManager.activateSessionData(trimmedSessionId)
    );
    return;
  }

  commitSessionSurface(session, options);
  if (epoch !== navEpoch) {
    return;
  }

  await settleSessionActivation(trimmedSessionId);
}

export async function openHome(options?: {
  context?: WorkspaceSurfaceContext | null;
  currentOsSessionId?: string | null;
}): Promise<string | null> {
  const epoch = ++navEpoch;
  const state = useWorkspaceSurfaceStore.getState();

  if (state.activeSurface.kind === 'agentic-os-home') {
    const existingOsSessionId = options?.currentOsSessionId ?? state.currentOsSessionId;
    if (existingOsSessionId) {
      await openSession(existingOsSessionId, { context: options?.context });
      return existingOsSessionId;
    }
  }

  const resolvedOsSessionId =
    options?.currentOsSessionId ??
    state.currentOsSessionId ??
    findLatestAgenticOsSessionId();

  if (resolvedOsSessionId) {
    if (epoch !== navEpoch) {
      return null;
    }
    await openSession(resolvedOsSessionId, { context: options?.context });
    return resolvedOsSessionId;
  }

  if (epoch !== navEpoch) {
    return null;
  }

  const newSessionId = await (async () => {
    const { flowChatManager } = await import('@/flow_chat/services/FlowChatManager');
    return flowChatManager.createChatSession(
      { storageScope: 'agentic_os', navigate: false },
      getAgenticOsSessionDescriptor(),
    );
  })();

  if (epoch !== navEpoch) {
    return null;
  }

  useWorkspaceSurfaceStore.getState().openSurface(createAgenticOsHomeSurface(), {
    context: options?.context,
    currentOsSessionId: newSessionId,
  });
  await settleSessionActivation(newSessionId);
  return newSessionId;
}

export function getActiveWorkspaceSurface() {
  return useWorkspaceSurfaceStore.getState().activeSurface;
}

/** Synchronous home commit for startup — shows home chrome before async session resolve. */
export function commitStartupHome(): void {
  ++navEpoch;
  useWorkspaceSurfaceStore.getState().openSurface(createAgenticOsHomeSurface());
}
