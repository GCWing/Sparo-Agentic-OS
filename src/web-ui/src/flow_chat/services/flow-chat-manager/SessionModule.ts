/**
 * Session management module
 * Handles session creation, switching, deletion, and other operations
 */

import { agentAPI } from '@/infrastructure/api/service-api/AgentAPI';
import { sessionAPI } from '@/infrastructure/api/service-api/SessionAPI';
import { notificationService } from '../../../shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import { i18nService } from '@/infrastructure/i18n';
import { workspaceManager } from '@/infrastructure/services/business/workspaceManager';
import type { WorkspaceInfo } from '@/shared/types';
import type { FlowChatContext, SessionConfig } from './types';
import { touchSessionActivity, cleanupSaveState, updateSessionMetadata } from './PersistenceModule';
import { useWorkspaceSurfaceStore } from '@/app/navigation/workspaceSurfaceStore';
import { resolveSessionTypeDefinitionForDescriptor } from '@/app/session-profiles';
import { sessionMatchesWorkspace } from '../../utils/workspaceScope';
import {
  getBackendAgentType,
  getDefaultSessionDescriptor,
  sessionDomainForDescriptor,
  type SessionDescriptor,
} from '../../domain/sessionDescriptor';
import { canHydrateSession } from '../../domain/sessionLoadPhase';

const log = createLogger('SessionModule');
const pendingSessionCreations = new Map<string, Promise<string>>();
const pendingBackendSessionRecreations = new Map<string, Promise<void>>();
const pendingLocalBackendSessionCreations = new Set<string>();

export function isLocalBackendSessionCreationPending(sessionId: string): boolean {
  return pendingLocalBackendSessionCreations.has(sessionId);
}

export interface CreateChatSessionOptions {
  sessionId?: string;
  notifyOnError?: boolean;
}

async function hydrateHistoricalSession(
  context: FlowChatContext,
  sessionId: string,
  notifyOnError: boolean
): Promise<void> {
  const existing = context.pendingHistoryLoads.get(sessionId);
  if (existing) {
    await existing;
    return;
  }

  const loadPromise = (async () => {
    const session = context.flowChatStore.getState().sessions.get(sessionId);
    if (!session || !canHydrateSession(session)) {
      return;
    }

    const workspacePath = requireSessionWorkspacePath(
      session.workspacePath,
      sessionId,
      session.domain,
    );

    await context.flowChatStore.loadSessionHistory(
      sessionId,
      workspacePath,
      session.domain,
      undefined,
    );
  })();

  context.pendingHistoryLoads.set(sessionId, loadPromise);

  try {
    await loadPromise;
  } catch (error) {
    log.error('Failed to load session history', { sessionId, error });
    if (notifyOnError) {
      notificationService.warning('Failed to load session history. Retry from the conversation.', {
        duration: 3000
      });
    }
    throw error;
  } finally {
    if (context.pendingHistoryLoads.get(sessionId) === loadPromise) {
      context.pendingHistoryLoads.delete(sessionId);
    }
  }
}

const resolveSessionWorkspacePath = (
  context: FlowChatContext,
  config?: SessionConfig
): string | null => {
  const explicitWorkspacePath = config?.workspacePath?.trim();
  if (explicitWorkspacePath) {
    return explicitWorkspacePath;
  }
  if (config?.domain?.kind !== 'workspace') {
    return null;
  }
  const fromFlowChat = context.workspaceContextPath?.trim();
  if (fromFlowChat) {
    return fromFlowChat;
  }
  return null;
};

const resolveSessionWorkspace = (
  context: FlowChatContext,
  config?: SessionConfig
): WorkspaceInfo | null => {
  const state = workspaceManager.getState();
  const configWorkspaceId = config?.workspaceId?.trim();
  if (configWorkspaceId) {
    const byId = state.openedWorkspaces.get(configWorkspaceId);
    if (byId) return byId;
  }

  const workspacePath = resolveSessionWorkspacePath(context, config);
  if (!workspacePath) return null;
  const pathMatches = Array.from(state.openedWorkspaces.values()).filter(
    workspace => workspace.rootPath === workspacePath
  );
  if (pathMatches.length === 0) {
    return null;
  }
  if (pathMatches.length === 1) {
    return pathMatches[0];
  }
  return pathMatches[0];
};

function requireSessionWorkspacePath(
  workspacePath: string | undefined,
  sessionId: string,
  domain: import('@/shared/types/session-history').SessionDomain,
): string {
  if (domain.kind !== 'workspace') {
    return workspacePath || '';
  }
  if (!workspacePath) {
    throw new Error(`Workspace path is required for session: ${sessionId}`);
  }
  return workspacePath;
}

/**
 * Create new chat session (managed by backend)
 */
export async function createChatSession(
  context: FlowChatContext,
  config: SessionConfig,
  descriptor: SessionDescriptor = getDefaultSessionDescriptor(),
  options: CreateChatSessionOptions = {},
): Promise<string> {
  try {
    const workspacePath = resolveSessionWorkspacePath(context, config);
    const workspace = resolveSessionWorkspace(context, config);
    const domain =
      config.domain ??
      sessionDomainForDescriptor(descriptor, workspace?.id ?? config.workspaceId);
    const sessionType = resolveSessionTypeDefinitionForDescriptor(descriptor);

    if (!workspacePath && domain.kind === 'workspace') {
      throw new Error('Workspace path is required to create a session');
    }

    const sessionMode = sessionType.lifecycle.displayMode;
    const agentType = getBackendAgentType(descriptor);

    const creationKey =
      config.creationDeduplicationKey?.trim()
        ? config.creationDeduplicationKey.trim()
        : `${domain.kind}:${
            domain.kind === 'workspace' ? domain.workspace_id : descriptor.identityId
          }`;

    const pendingCreation = pendingSessionCreations.get(creationKey);
    if (pendingCreation) {
      return pendingCreation;
    }

    const sameModeCount =
      Array.from(context.flowChatStore.getState().sessions.values()).filter(
        session => resolveSessionTypeDefinitionForDescriptor(session.descriptor).lifecycle.displayMode === sessionMode
      ).length + 1;
    const generatedSessionName = i18nService.t(sessionType.lifecycle.titleKey, { count: sameModeCount });
    const sessionName = config.sessionName?.trim() || generatedSessionName;
    
    const mergedConfig: SessionConfig = {
      ...config,
      workspaceId: workspace?.id ?? config.workspaceId,
      domain,
    };

    const createPromise = (async () => {
      const requestedSessionId = options.sessionId?.trim() || undefined;
      if (requestedSessionId) {
        pendingLocalBackendSessionCreations.add(requestedSessionId);
      }
      try {
        const response = await agentAPI.createSession({
          sessionId: requestedSessionId,
          sessionName,
          agentType,
          workspacePath: workspacePath || undefined,
          domain,
          config: {
            modelName: config.modelName || 'primary',
            enableTools: true,
            safeMode: true,
            autoCompact: true,
            contextPolicy: { mode: 'followModel' },
            enableContextCompression: true,
          }
        });

        if (requestedSessionId && response.sessionId !== requestedSessionId) {
          throw new Error('Backend returned an unexpected session id for optimistic navigation');
        }

        context.flowChatStore.createSession(
          response.sessionId,
          mergedConfig,
          undefined,
          sessionName,
          undefined,
          descriptor,
          workspacePath || undefined,
        );

        const shouldNavigate = config.navigate !== false;
        if (shouldNavigate) {
          const { openSession: openSessionNav } = await import('@/app/navigation/navigationController');
          await openSessionNav(response.sessionId);
        }

        return response.sessionId;
      } finally {
        if (requestedSessionId) {
          pendingLocalBackendSessionCreations.delete(requestedSessionId);
        }
      }
    })();

    pendingSessionCreations.set(creationKey, createPromise);
    try {
      return await createPromise;
    } finally {
      if (pendingSessionCreations.get(creationKey) === createPromise) {
        pendingSessionCreations.delete(creationKey);
      }
    }
  } catch (error) {
    log.error('Failed to create chat session', { config, error });
    
    if (options.notifyOnError !== false) {
      notificationService.error('Failed to create chat session', {
        duration: 3000
      });
    }
    throw error;
  }
}

/**
 * Background session activation: touch activity and hydrate history.
 * Does not change navigation surface — use navigationController.openSession for that.
 */
export async function activateSessionData(
  context: FlowChatContext,
  sessionId: string
): Promise<void> {
  try {
    const session = context.flowChatStore.getState().sessions.get(sessionId);

    touchSessionActivity(
      sessionId,
      session?.domain,
    ).catch(error => {
      log.debug('Failed to touch session activity', { sessionId, error });
    });

    if (canHydrateSession(session)) {
      void hydrateHistoricalSession(context, sessionId, true).catch(() => {
        // hydrateHistoricalSession already records, notifies, and sets the
        // persistent retryable phase. Activation itself remains non-blocking.
      });

    }
  } catch (error) {
    log.error('Failed to activate session data', { sessionId, error });
    throw error;
  }
}

export async function retrySessionHistory(
  context: FlowChatContext,
  sessionId: string,
): Promise<void> {
  await hydrateHistoricalSession(context, sessionId, true);
}

/**
 * @deprecated Use navigationController.openSession for UI switching.
 * Kept for internal callers that only need data activation after navigation committed.
 */
export async function switchChatSession(
  context: FlowChatContext,
  sessionId: string
): Promise<void> {
  context.flowChatStore.switchSession(sessionId);
  await activateSessionData(context, sessionId);
}

/**
 * Delete session (cascading delete Terminal)
 */
export async function deleteChatSession(
  context: FlowChatContext,
  sessionId: string
): Promise<void> {
  try {
    const removedSessionIds = context.flowChatStore.getCascadeSessionIds(sessionId);
    await context.flowChatStore.deleteSession(sessionId);
    removedSessionIds.forEach(id => {
      context.processingManager.clearSessionStatus(id);
      cleanupSaveState(context, id);
    });
    useWorkspaceSurfaceStore.getState().forgetSessions(removedSessionIds);
  } catch (error) {
    log.error('Failed to delete chat session', { sessionId, error });
    notificationService.error('Failed to delete session', {
      duration: 3000
    });
    throw error;
  }
}

export async function retargetEmptyChatSessionWorkspace(
  context: FlowChatContext,
  sessionId: string,
  workspace: Pick<WorkspaceInfo, 'id' | 'rootPath'>,
  preferredDescriptor?: SessionDescriptor
): Promise<string> {
  const workspacePath = workspace.rootPath.trim();
  if (!workspacePath) {
    throw new Error('Workspace path is required to retarget a chat session');
  }

  const session = context.flowChatStore.getState().sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session does not exist: ${sessionId}`);
  }
  if (session.isTransient) {
    throw new Error('Transient sessions cannot be retargeted');
  }
  if (session.dialogTurns.length > 0) {
    throw new Error('Only empty sessions can be retargeted to another workspace');
  }
  if (
    canHydrateSession(session) ||
    session.loadPhase === 'hydrating' ||
    context.pendingHistoryLoads.has(sessionId)
  ) {
    throw new Error('Session history is still restoring, please retry once loading finishes');
  }
  if (context.processingManager.getSessionStatuses(sessionId).length > 0) {
    throw new Error('Session is busy and cannot be retargeted');
  }

  const descriptor =
    preferredDescriptor?.sessionDomainKind === 'workspace'
      ? preferredDescriptor
      : session.descriptor.sessionDomainKind === 'workspace'
        ? session.descriptor
        : getDefaultSessionDescriptor();

  if (session.domain.kind !== 'workspace' || descriptor.sessionDomainKind !== 'workspace') {
    throw new Error('Only workspace-scoped sessions can be retargeted');
  }

  const workspaceChanged = !sessionMatchesWorkspace(session, workspace);

  if (workspaceChanged) {
    await agentAPI.deleteSession({
      session_id: sessionId,
      domain: session.domain,
    });
    await agentAPI.createSession({
      sessionId,
      sessionName: session.title || `Session ${sessionId.slice(0, 8)}`,
      agentType: getBackendAgentType(descriptor),
      workspacePath,
      domain: { kind: 'workspace', workspace_id: workspace.id },
      config: {
        modelName: session.config.modelName || 'primary',
        enableTools: true,
        safeMode: true,
      },
    });
  }

  context.flowChatStore.retargetEmptySessionWorkspace(
    sessionId,
    workspace,
    descriptor,
  );

  await ensureBackendSession(context, sessionId);
  await updateSessionMetadata(context, sessionId);

  const { openSession: openSessionNav } = await import('@/app/navigation/navigationController');
  await openSessionNav(sessionId);

  return sessionId;
}

export async function renameChatSessionTitle(
  context: FlowChatContext,
  sessionId: string,
  title: string
): Promise<string> {
  const session = context.flowChatStore.getState().sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session does not exist: ${sessionId}`);
  }

  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    throw new Error('Session title must not be empty');
  }
  if (session.isTransient) {
    await context.flowChatStore.updateSessionTitle(sessionId, trimmedTitle, 'generated');
    return trimmedTitle;
  }

  const updatedTitle = await agentAPI.updateSessionTitle({
    locator: { session_id: sessionId, domain: session.domain },
    title: trimmedTitle,
  });

  await context.flowChatStore.updateSessionTitle(sessionId, updatedTitle, 'generated');
  return updatedTitle;
}

export async function forkChatSession(
  context: FlowChatContext,
  sourceSessionId: string,
  sourceTurnId: string
): Promise<string> {
  const sourceSession = context.flowChatStore.getState().sessions.get(sourceSessionId);
  if (!sourceSession) {
    throw new Error(`Session does not exist: ${sourceSessionId}`);
  }

  const workspacePath = requireSessionWorkspacePath(
    sourceSession.workspacePath,
    sourceSessionId,
    sourceSession.domain,
  );

  const response = await sessionAPI.forkSession(
    { session_id: sourceSessionId, domain: sourceSession.domain },
    sourceTurnId,
  );

  const currentState = context.flowChatStore.getState();
  if (!currentState.sessions.has(response.sessionId)) {
    context.flowChatStore.createSession(
      response.sessionId,
      {
        ...sourceSession.config,
        workspacePath,
        workspaceId: sourceSession.workspaceId,
        domain: sourceSession.domain,
      },
      undefined,
      response.sessionName,
      undefined,
      sourceSession.descriptor,
      workspacePath,
    );
  } else {
    context.flowChatStore.switchSession(response.sessionId);
  }

  await context.flowChatStore.loadSessionHistory(
    response.sessionId,
    workspacePath,
    sourceSession.domain,
    undefined,
  );
  context.flowChatStore.switchSession(response.sessionId);

  return response.sessionId;
}

/**
 * Ensure backend session exists (check before sending message)
 */
async function ensureBackendSessionOnce(
  context: FlowChatContext,
  sessionId: string
): Promise<void> {
  const pendingHistoryLoad = context.flowChatStore.getPendingSessionHistoryLoad(sessionId)
    ?? context.pendingHistoryLoads.get(sessionId);
  if (pendingHistoryLoad) {
    await pendingHistoryLoad;
  }

  const session = context.flowChatStore.getState().sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session does not exist: ${sessionId}`);
  }
  if (session.isTransient) {
    return;
  }

  if (canHydrateSession(session)) {
    await hydrateHistoricalSession(context, sessionId, false);
  }

  const latestSession = context.flowChatStore.getState().sessions.get(sessionId) ?? session;
  const workspacePath = requireSessionWorkspacePath(
    latestSession.workspacePath,
    sessionId,
    latestSession.domain,
  );

  const isMetadataOnlySession = canHydrateSession(latestSession);
  const isFirstTurn = latestSession.dialogTurns.length <= 1;
  const needsBackendSetup = isMetadataOnlySession || isFirstTurn;
  /** Avoid createSession when historical data is already loaded but backend files are missing (e.g. new SSH connection id). */
  const allowRecreateOnCoordinatorFailure =
    needsBackendSetup && !(isMetadataOnlySession && latestSession.dialogTurns.length > 1);

  const markLiveIfMetadataOnly = () => {
    if (!isMetadataOnlySession) return;
    context.flowChatStore.setSessionLoadPhase(sessionId, 'live');
  };

  try {
    await agentAPI.ensureCoordinatorSession({
      locator: { session_id: sessionId, domain: latestSession.domain },
    });
    markLiveIfMetadataOnly();
  } catch (e: any) {
    if (!allowRecreateOnCoordinatorFailure) {
      const raw = typeof e?.message === 'string' ? e.message : String(e);
      const hint =
        raw.includes('Session metadata not found') || raw.includes('Not found')
          ? '在后端找不到该会话数据。请确认工作区路径正确，或新建会话后再试。'
          : raw;
      throw new Error(hint);
    }

    log.debug('Coordinator session missing, creating backend session', { sessionId, error: e });
    pendingLocalBackendSessionCreations.add(sessionId);
    try {
      await agentAPI.createSession({
        sessionId: sessionId,
        sessionName: latestSession.title || `Session ${sessionId.slice(0, 8)}`,
        agentType: getBackendAgentType(latestSession.descriptor),
        workspacePath,
        domain: latestSession.domain,
        config: {
          modelName: latestSession.config.modelName || 'primary',
          enableTools: true,
          safeMode: true,
        }
      });
    } finally {
      pendingLocalBackendSessionCreations.delete(sessionId);
    }
    markLiveIfMetadataOnly();
  }
}

export async function ensureBackendSession(
  context: FlowChatContext,
  sessionId: string,
  afterReady?: () => Promise<void>,
): Promise<void> {
  const pendingReadiness = context.pendingBackendReadiness
    ?? (context.pendingBackendReadiness = new Map<string, { tail: Promise<void> }>());
  let entry = pendingReadiness.get(sessionId);
  if (!entry) {
    entry = { tail: ensureBackendSessionOnce(context, sessionId) };
    pendingReadiness.set(sessionId, entry);
  }
  if (afterReady) {
    entry.tail = entry.tail.then(afterReady);
  }

  let observedTail = entry.tail;
  try {
    while (true) {
      observedTail = entry.tail;
      await observedTail;
      if (entry.tail === observedTail) return;
    }
  } finally {
    if (pendingReadiness.get(sessionId) === entry && entry.tail === observedTail) {
      pendingReadiness.delete(sessionId);
    }
  }
}

/**
 * Retry creating backend session (retry after message send failure)
 */
async function retryCreateBackendSessionOnce(
  context: FlowChatContext,
  sessionId: string
): Promise<void> {
  const session = context.flowChatStore.getState().sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session does not exist: ${sessionId}`);
  }
  if (session.isTransient) {
    return;
  }

  const workspacePath = requireSessionWorkspacePath(
    session.workspacePath,
    sessionId,
    session.domain,
  );
  
  pendingLocalBackendSessionCreations.add(sessionId);
  try {
    await agentAPI.createSession({
      sessionId: sessionId,
      sessionName: session.title || `Session ${sessionId.slice(0, 8)}`,
      agentType: getBackendAgentType(session.descriptor),
      workspacePath,
      domain: session.domain,
      config: {
        modelName: session.config.modelName || 'primary',
        enableTools: true,
        safeMode: true,
      }
    });
  } finally {
    pendingLocalBackendSessionCreations.delete(sessionId);
  }
}

export async function retryCreateBackendSession(
  context: FlowChatContext,
  sessionId: string,
): Promise<void> {
  const existing = pendingBackendSessionRecreations.get(sessionId);
  if (existing) return existing;

  let pending: Promise<void>;
  pending = (async () => {
    const pendingReadiness = context.pendingBackendReadiness
      ?? (context.pendingBackendReadiness = new Map<string, { tail: Promise<void> }>());
    let entry = pendingReadiness.get(sessionId);
    if (entry) {
      entry.tail = entry.tail.then(() => retryCreateBackendSessionOnce(context, sessionId));
    } else {
      entry = { tail: retryCreateBackendSessionOnce(context, sessionId) };
      pendingReadiness.set(sessionId, entry);
    }

    let observedTail = entry.tail;
    try {
      while (true) {
        observedTail = entry.tail;
        await observedTail;
        if (entry.tail === observedTail) return;
      }
    } finally {
      if (pendingReadiness.get(sessionId) === entry && entry.tail === observedTail) {
        pendingReadiness.delete(sessionId);
      }
    }
  })().finally(() => {
    if (pendingBackendSessionRecreations.get(sessionId) === pending) {
      pendingBackendSessionRecreations.delete(sessionId);
    }
  });
  pendingBackendSessionRecreations.set(sessionId, pending);
  return pending;
}
