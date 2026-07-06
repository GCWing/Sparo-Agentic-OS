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
  type SessionDescriptor,
} from '../../domain/sessionDescriptor';
import { canHydrateSession } from '../../domain/sessionLoadPhase';

const log = createLogger('SessionModule');
const pendingSessionCreations = new Map<string, Promise<string>>();

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
      session.storageScope
    );

    await context.flowChatStore.loadSessionHistory(
      sessionId,
      workspacePath,
      undefined,
      session.storageScope
    );
  })();

  context.pendingHistoryLoads.set(sessionId, loadPromise);

  try {
    await loadPromise;
  } catch (error) {
    log.error('Failed to load session history', { sessionId, error });
    if (notifyOnError) {
      notificationService.warning('Failed to load session history, showing empty session', {
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
  if (config?.storageScope === 'agentic_os') {
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
  storageScope?: import('@/shared/types/session-history').SessionStorageScope
): string {
  if (storageScope === 'agentic_os') {
    return workspacePath || '';
  }
  if (!workspacePath) {
    throw new Error(`Workspace path is required for session: ${sessionId}`);
  }
  return workspacePath;
}

/**
 * Get model's maximum token count
 */
export async function getModelMaxTokens(modelName?: string): Promise<number> {
  try {
    const configManager = await import('@/infrastructure/config/services/ConfigManager').then(m => m.configManager);
    const models = await configManager.getConfig<any[]>('ai.models') || [];
    
    if (modelName) {
      const model = models.find(m => m.name === modelName || m.id === modelName);
      if (model?.context_window) {
        return model.context_window;
      }
    }
    
    const defaultModels = await configManager.getConfig<Record<string, string>>('ai.default_models');
    const primaryModelId = defaultModels?.primary;
    
    if (primaryModelId) {
      const primaryModel = models.find(m => m.id === primaryModelId);
      if (primaryModel?.context_window) {
        return primaryModel.context_window;
      }
    }
    
    log.debug('Model context_window config not found, using default', { modelName });
    return 128128;
  } catch (error) {
    log.warn('Failed to get model max tokens', { modelName, error });
    return 128128;
  }
}

/**
 * Create new chat session (managed by backend)
 */
export async function createChatSession(
  context: FlowChatContext,
  config: SessionConfig,
  descriptor: SessionDescriptor = getDefaultSessionDescriptor()
): Promise<string> {
  try {
    const workspacePath = resolveSessionWorkspacePath(context, config);
    const workspace = resolveSessionWorkspace(context, config);
    const storageScope = config.storageScope ?? descriptor.storageScope;
    const sessionType = resolveSessionTypeDefinitionForDescriptor(descriptor);

    if (!workspacePath && storageScope !== 'agentic_os') {
      throw new Error('Workspace path is required to create a session');
    }

    const sessionMode = sessionType.lifecycle.displayMode;
    const agentType = getBackendAgentType(descriptor);

    const creationKey =
      config.creationDeduplicationKey?.trim()
        ? config.creationDeduplicationKey.trim()
        : storageScope === 'agentic_os'
        ? `${descriptor.hostKind}:${descriptor.identityId}`
        : workspace?.id?.trim()
        ? workspace.id
        : workspacePath ?? 'agentic_os';

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
    
    const maxContextTokens = await getModelMaxTokens(config.modelName);

    const mergedConfig: SessionConfig = {
      ...config,
      workspaceId: workspace?.id ?? config.workspaceId,
    };

    const createPromise = (async () => {
      const response = await agentAPI.createSession({
        sessionName,
        agentType,
        workspacePath: workspacePath || undefined,
        storageScope,
        config: {
          modelName: config.modelName || 'primary',
          enableTools: true,
          safeMode: true,
          autoCompact: true,
          maxContextTokens: maxContextTokens,
          enableContextCompression: true,
          storageScope,
        }
      });

      context.flowChatStore.createSession(
        response.sessionId, 
        mergedConfig, 
        undefined,
        sessionName,
        maxContextTokens,
        descriptor,
        workspacePath || undefined,
        storageScope
      );

      const shouldNavigate = config.navigate !== false;
      if (shouldNavigate) {
        const { openSession: openSessionNav } = await import('@/app/navigation/navigationController');
        await openSessionNav(response.sessionId);
      }

      return response.sessionId;
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
    
    notificationService.error('Failed to create chat session', {
      duration: 3000
    });
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
      session?.workspacePath,
      session?.storageScope
    ).catch(error => {
      log.debug('Failed to touch session activity', { sessionId, error });
    });

    if (canHydrateSession(session)) {
      void hydrateHistoricalSession(context, sessionId, true);
    }
  } catch (error) {
    log.error('Failed to activate session data', { sessionId, error });
    throw error;
  }
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
    preferredDescriptor?.storageScope === 'workspace'
      ? preferredDescriptor
      : session.descriptor.storageScope === 'workspace'
        ? session.descriptor
        : getDefaultSessionDescriptor();

  if (session.storageScope === 'agentic_os' || descriptor.storageScope !== 'workspace') {
    throw new Error('Only workspace-scoped sessions can be retargeted');
  }

  const previousWorkspacePath = session.workspacePath;
  const previousStorageScope = session.storageScope;
  const workspaceChanged = !sessionMatchesWorkspace(session, workspace);

  if (workspaceChanged) {
    try {
      await agentAPI.updateSessionWorkspace({ sessionId, workspacePath });
    } catch (error: any) {
      const message = typeof error?.message === 'string' ? error.message : String(error);
      if (!message.includes('Session not found') && !message.includes('Not found')) {
        throw error;
      }
    }
  }

  context.flowChatStore.retargetEmptySessionWorkspace(
    sessionId,
    workspace,
    descriptor,
    'workspace'
  );

  if (workspaceChanged && previousWorkspacePath) {
    try {
      await sessionAPI.deleteSession(sessionId, previousWorkspacePath, previousStorageScope);
    } catch (error) {
      log.debug('Failed to delete empty session metadata from previous workspace', {
        sessionId,
        workspacePath: previousWorkspacePath,
        error,
      });
    }
  }

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
    sessionId,
    title: trimmedTitle,
    workspacePath: session.workspacePath,
    storageScope: session.storageScope,
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
    sourceSession.storageScope
  );

  const response = await sessionAPI.forkSession(
    sourceSessionId,
    sourceTurnId,
    workspacePath,
    sourceSession.storageScope
  );

  const currentState = context.flowChatStore.getState();
  if (!currentState.sessions.has(response.sessionId)) {
    context.flowChatStore.createSession(
      response.sessionId,
      {
        ...sourceSession.config,
        workspacePath,
        workspaceId: sourceSession.workspaceId,
        storageScope: sourceSession.storageScope,
      },
      undefined,
      response.sessionName,
      sourceSession.maxContextTokens,
      sourceSession.descriptor,
      workspacePath,
      sourceSession.storageScope
    );
  } else {
    context.flowChatStore.switchSession(response.sessionId);
  }

  await context.flowChatStore.loadSessionHistory(
    response.sessionId,
    workspacePath,
    undefined,
    sourceSession.storageScope
  );
  context.flowChatStore.switchSession(response.sessionId);

  return response.sessionId;
}

/**
 * Ensure backend session exists (check before sending message)
 */
export async function ensureBackendSession(
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

  if (canHydrateSession(session)) {
    await hydrateHistoricalSession(context, sessionId, false);
  }

  const latestSession = context.flowChatStore.getState().sessions.get(sessionId) ?? session;
  const workspacePath = requireSessionWorkspacePath(
    latestSession.workspacePath,
    sessionId,
    latestSession.storageScope
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
      sessionId,
      workspacePath,
      storageScope: latestSession.storageScope,
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
    await agentAPI.createSession({
      sessionId: sessionId,
      sessionName: latestSession.title || `Session ${sessionId.slice(0, 8)}`,
      agentType: getBackendAgentType(latestSession.descriptor),
      workspacePath,
      storageScope: latestSession.storageScope,
      config: {
        modelName: latestSession.config.modelName || 'primary',
        enableTools: true,
        safeMode: true,
        storageScope: latestSession.storageScope,
      }
    });
    markLiveIfMetadataOnly();
  }
}

/**
 * Retry creating backend session (retry after message send failure)
 */
export async function retryCreateBackendSession(
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
    session.storageScope
  );
  
  await agentAPI.createSession({
    sessionId: sessionId,
    sessionName: session.title || `Session ${sessionId.slice(0, 8)}`,
    agentType: getBackendAgentType(session.descriptor),
    workspacePath,
    storageScope: session.storageScope,
    config: {
      modelName: session.config.modelName || 'primary',
      enableTools: true,
      safeMode: true,
      storageScope: session.storageScope,
    }
  });
}
