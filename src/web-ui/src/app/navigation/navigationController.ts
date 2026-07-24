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
import { useModernFlowChatStore } from '@/flow_chat/store/modernFlowChatStore';
import {
  descriptorFromAgentType,
  getAgenticOsSessionDescriptor,
  isSystemAgenticOsSession,
} from '@/flow_chat/domain/sessionDescriptor';
import type { Session } from '@/flow_chat/types/flow-chat';
import { resolveSessionTypeDefinitionForDescriptor } from '@/app/session-profiles';
import { sessionAPI } from '@/infrastructure/api/service-api/SessionAPI';
import {
  projectRuntimeScopeFromWorkspacePath,
  runtimeScopeFromAppScope,
  systemRuntimeScope,
  type RuntimeScope,
} from '@/shared/types/runtime-scope';
import type { AppScope } from '@/shared/types/app-scope';
import type { ProductAppRuntimeContext } from '@/shared/types/product-app-runtime';
import type { SessionMetadata } from '@/shared/types/session-history';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('NavigationController');

let navEpoch = 0;

interface PendingSessionShell {
  epoch: number;
  sessionId: string;
  baseline: ReturnType<typeof useWorkspaceSurfaceStore.getState>;
}

let pendingSessionShell: PendingSessionShell | null = null;

export function getNavigationEpoch(): number {
  return navEpoch;
}

function restorePendingSessionBaseline(): boolean {
  const pending = pendingSessionShell;
  if (!pending) return false;
  pendingSessionShell = null;
  if (selectFocusedSessionId(useWorkspaceSurfaceStore.getState()) !== pending.sessionId) {
    return false;
  }
  restoreSurfaceAfterMissingSession(pending.baseline);
  return true;
}

/** Reserve ownership before an async navigation preflight begins. */
export function beginNavigationIntent(): number {
  restorePendingSessionBaseline();
  return ++navEpoch;
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
  /** Commit a target session shell before metadata I/O so loading UI can paint. */
  commitPendingSurface?: boolean;
  /** Epoch reserved by a higher-level navigation intent such as Work opening. */
  navigationEpoch?: number;
  /** Optional owner-provided readiness for a session being created right now. */
  resolveSession?: () => Promise<Session | null>;
}

export type OpenWorkspaceSessionResult = 'opened' | 'missing' | 'superseded';

/** Paint a loading session shell while its owner prepares the real session. */
export function commitPendingSessionNavigation(
  sessionId: string,
  options: OpenWorkspaceSessionOptions,
): boolean {
  const trimmedSessionId = sessionId.trim();
  if (!trimmedSessionId) return false;
  const epoch = options.navigationEpoch ?? ++navEpoch;
  if (epoch !== navEpoch) return false;

  const baseline = pendingSessionShell?.baseline ?? useWorkspaceSurfaceStore.getState();
  commitPendingSessionSurface(trimmedSessionId, options, pendingSessionShell !== null);
  pendingSessionShell = {
    epoch,
    sessionId: trimmedSessionId,
    baseline,
  };
  return true;
}

export function cancelPendingSessionNavigation(epoch: number): boolean {
  if (pendingSessionShell?.epoch !== epoch) return false;
  return restorePendingSessionBaseline();
}

function resolveSceneScope(options: OpenWorkspaceSceneOptions): RuntimeScope {
  if (options.scope) {
    return options.scope;
  }
  if (options.appScope) {
    return runtimeScopeFromAppScope(options.appScope);
  }
  if (options.workspacePath === null) {
    return systemRuntimeScope('os_agent');
  }
  return projectRuntimeScopeFromWorkspacePath(options.workspacePath) ?? systemRuntimeScope('os_agent');
}

function isTopLevelAgenticOsSession(session: Session): boolean {
  return (
    isSystemAgenticOsSession(session.descriptor) &&
    !session.parentSessionId &&
    session.sessionKind === 'normal'
  );
}

function isKnownEmptyAgenticOsSession(session: Session): boolean {
  if (!isTopLevelAgenticOsSession(session) || session.dialogTurns.length > 0) {
    return false;
  }
  return session.loadPhase === 'live' || session.loadPhase === 'hydrated';
}

function isTopLevelAgenticOsMetadata(metadata: SessionMetadata): boolean {
  return (
    isSystemAgenticOsSession(descriptorFromAgentType(metadata.agentType)) &&
    metadata.sessionKind !== 'subagent' &&
    !metadata.customMetadata?.parentSessionId
  );
}

function isEmptyAgenticOsMetadata(metadata: SessionMetadata): boolean {
  return (
    metadata.turnCount === 0 &&
    metadata.messageCount === 0 &&
    metadata.toolCallCount === 0
  );
}

function findLatestKnownEmptyAgenticOsSessionId(): string | null {
  const latestSession = Array.from(flowChatStore.getState().sessions.values())
    .filter(isTopLevelAgenticOsSession)
    .sort(
      (a, b) =>
        (b.lastActiveAt ?? b.createdAt ?? 0) - (a.lastActiveAt ?? a.createdAt ?? 0)
    )[0] ?? null;
  return latestSession && isKnownEmptyAgenticOsSession(latestSession)
    ? latestSession.sessionId
    : null;
}

async function resolveReusableEmptyAgenticOsSessionId(): Promise<string | null> {
  try {
    const metadata = await sessionAPI.listSessions({ kind: 'os_agent' });
    await flowChatStore.hydrateWorkspaceSessionsMetadata(metadata, '');

    const latestMetadata = metadata
      .filter(isTopLevelAgenticOsMetadata)
      .sort(
        (a, b) =>
          (b.lastActiveAt ?? b.createdAt ?? 0) - (a.lastActiveAt ?? a.createdAt ?? 0)
      )[0] ?? null;

    if (!latestMetadata) {
      return findLatestKnownEmptyAgenticOsSessionId();
    }

    return isEmptyAgenticOsMetadata(latestMetadata)
      ? latestMetadata.sessionId
      : null;
  } catch (error) {
    log.warn('Failed to load Agentic OS sessions before opening home', error);
  }

  return findLatestKnownEmptyAgenticOsSessionId();
}

async function ensureSessionInStore(sessionId: string): Promise<Session | null> {
  const existing = flowChatStore.getState().sessions.get(sessionId);
  if (existing) {
    return existing;
  }

  log.warn('Session not loaded in the active workspace context', { sessionId });
  return null;
}

function commitSessionSurface(
  session: Session,
  options: OpenWorkspaceSessionOptions = {},
  replacePendingSurface = false,
): void {
  const sessionType = resolveSessionTypeDefinitionForDescriptor(session.descriptor);
  const surfacePolicy = sessionType.lifecycle.defaultSurface;

  if (surfacePolicy === 'agentic-os-home') {
    useWorkspaceSurfaceStore.getState().openSurface(createAgenticOsHomeSurface(), {
      context: options.context,
      currentOsSessionId: session.sessionId,
      historyMode: replacePendingSurface ? 'restore' : undefined,
    });
    return;
  }

  if (surfacePolicy === 'session') {
    useWorkspaceSurfaceStore.getState().openSurface(
      { kind: 'session', sessionId: session.sessionId },
      {
        context: options.context,
        historyMode: replacePendingSurface ? 'restore' : undefined,
      },
    );
    return;
  }

  log.warn('Session surface policy not handled for navigation', {
    sessionId: session.sessionId,
    surfacePolicy,
  });
}

function commitPendingSessionSurface(
  sessionId: string,
  options: OpenWorkspaceSessionOptions,
  replacePendingSurface = false,
): void {
  useWorkspaceSurfaceStore.getState().openSurface(
    { kind: 'session', sessionId },
    {
      context: options.context,
      historyMode: replacePendingSurface ? 'restore' : undefined,
    },
  );
  // Do not let the previous session's profile or application sidecar leak into
  // the pending shell while metadata is being resolved.
  useModernFlowChatStore.getState().setActiveSession(null);
}

function restoreSurfaceAfterMissingSession(
  previous: ReturnType<typeof useWorkspaceSurfaceStore.getState>,
): void {
  useWorkspaceSurfaceStore.getState().openSurface(previous.activeSurface, {
    context: previous.surfaceContext,
    historyMode: 'restore',
    currentOsSessionId: previous.currentOsSessionId,
  });
  useWorkspaceSurfaceStore.setState({
    previousSurface: previous.previousSurface,
    currentOsSessionId: previous.currentOsSessionId,
    sceneHistory: previous.sceneHistory,
    surfaceContext: previous.surfaceContext,
  });

  const previousSessionId = selectFocusedSessionId(previous);
  if (previousSessionId) {
    syncSessionToModernStore(previousSessionId);
  } else {
    useModernFlowChatStore.getState().setActiveSession(null);
  }
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
  restorePendingSessionBaseline();
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
  const restoredPendingBaseline = restorePendingSessionBaseline();
  ++navEpoch;
  if (restoredPendingBaseline) return true;
  return useWorkspaceSurfaceStore.getState().goBackScene();
}

export function openSceneHistoryEntry(index: number): boolean {
  restorePendingSessionBaseline();
  ++navEpoch;
  return useWorkspaceSurfaceStore.getState().openSceneHistoryEntry(index);
}

export async function openSession(
  sessionId: string,
  options: OpenWorkspaceSessionOptions = {}
): Promise<OpenWorkspaceSessionResult> {
  const trimmedSessionId = sessionId.trim();
  if (!trimmedSessionId) {
    return 'missing';
  }

  const epoch = options.navigationEpoch ?? ++navEpoch;
  if (epoch !== navEpoch) {
    return 'superseded';
  }
  const previousSurfaceState = useWorkspaceSurfaceStore.getState();
  const inheritedPendingShell = pendingSessionShell;
  const stableBaseline = inheritedPendingShell?.baseline ?? previousSurfaceState;
  const currentFocusedId = selectFocusedSessionId(previousSurfaceState);
  const sessionAlreadyKnown = flowChatStore.getState().sessions.has(trimmedSessionId);
  const committedPendingSurface = options.commitPendingSurface === true && !sessionAlreadyKnown;

  if (committedPendingSurface) {
    commitPendingSessionSurface(trimmedSessionId, options, inheritedPendingShell !== null);
    pendingSessionShell = {
      epoch,
      sessionId: trimmedSessionId,
      baseline: stableBaseline,
    };
  } else if (inheritedPendingShell) {
    pendingSessionShell = {
      ...inheritedPendingShell,
      epoch,
    };
  } else {
    pendingSessionShell = null;
  }

  let session: Session | null = null;
  try {
    session = options.resolveSession
      ? await options.resolveSession()
      : await ensureSessionInStore(trimmedSessionId);
  } catch (error) {
    log.warn('Session readiness failed during navigation', {
      sessionId: trimmedSessionId,
      error,
    });
  }
  if (epoch !== navEpoch) {
    return 'superseded';
  }
  if (!session) {
    if (pendingSessionShell?.epoch === epoch) {
      restoreSurfaceAfterMissingSession(pendingSessionShell.baseline);
      pendingSessionShell = null;
    }
    return 'missing';
  }
  const resolvedSessionId = session.sessionId;

  const replacingPendingSurface = pendingSessionShell?.epoch === epoch;
  if (replacingPendingSurface) {
    pendingSessionShell = null;
  }

  if (currentFocusedId === resolvedSessionId) {
    syncSessionToModernStore(resolvedSessionId);
    void import('@/flow_chat/services/FlowChatManager').then(({ flowChatManager }) =>
      flowChatManager.activateSessionData(resolvedSessionId)
    );
    return 'opened';
  }

  commitSessionSurface(session, options, replacingPendingSurface);
  if (epoch !== navEpoch) {
    return 'superseded';
  }

  await settleSessionActivation(resolvedSessionId);
  return 'opened';
}

export async function openHome(options?: {
  context?: WorkspaceSurfaceContext | null;
  currentOsSessionId?: string | null;
}): Promise<string | null> {
  const epoch = beginNavigationIntent();
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
    await resolveReusableEmptyAgenticOsSessionId();

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
      { domain: { kind: 'os_agent' }, navigate: false },
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
  pendingSessionShell = null;
  ++navEpoch;
  useWorkspaceSurfaceStore.getState().openSurface(createAgenticOsHomeSurface());
}
