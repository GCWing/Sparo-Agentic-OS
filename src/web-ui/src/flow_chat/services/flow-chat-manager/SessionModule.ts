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
import { touchSessionActivity, cleanupSaveState } from './PersistenceModule';
import { useWorkspaceSurfaceStore } from '@/app/navigation/workspaceSurfaceStore';

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
    if (!session?.isHistorical) {
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

type SessionDisplayMode =
  | 'code'
  | 'cowork'
  | 'design'
  | 'dispatcher'
  | 'liveappstudio'
  | 'agentappstudio';

const normalizeSessionDisplayMode = (
  mode?: string,
  _workspace?: WorkspaceInfo | null
): SessionDisplayMode => {
  const normalizedEarly = mode?.toLowerCase();
  if (normalizedEarly === 'liveappstudio') return 'liveappstudio';
  if (normalizedEarly === 'agentappstudio') return 'agentappstudio';
  if (!mode) return 'code';
  const normalizedMode = mode.toLowerCase();
  if (normalizedMode === 'cowork') return 'cowork';
  if (normalizedMode === 'design') return 'design';
  if (normalizedMode === 'dispatcher') return 'dispatcher';
  return 'code';
};

const resolveSessionWorkspacePath = (
  context: FlowChatContext,
  config?: SessionConfig
): string | null => {
  if (config?.storageScope === 'agentic_os') {
    return null;
  }
  const explicitWorkspacePath = config?.workspacePath?.trim();
  if (explicitWorkspacePath) {
    return explicitWorkspacePath;
  }
  const fromFlowChat = context.workspaceContextPath?.trim();
  if (fromFlowChat) {
    return fromFlowChat;
  }
  // AppLayout may delay FlowChat.initialize; use last opened workspace root when context path is unset.
  const lastUsed = workspaceManager.getState().lastUsedWorkspace;
  const root = lastUsed?.rootPath?.trim();
  if (!root) {
    return null;
  }
  return root;
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
    return state.lastUsedWorkspace;
  }
  if (pathMatches.length === 1) {
    return pathMatches[0];
  }
  const cur = state.lastUsedWorkspace;
  if (cur && pathMatches.some(w => w.id === cur.id)) {
    return cur;
  }
  return pathMatches[0];
};

const resolveAgentType = (
  requestedMode: string | undefined,
  _workspace: WorkspaceInfo | null
): string => {
  // If a mode is explicitly requested, always honor it.
  if (requestedMode) return requestedMode;
  return 'agentic';
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
  mode?: string
): Promise<string> {
  try {
    const workspacePath = resolveSessionWorkspacePath(context, config);
    const workspace = resolveSessionWorkspace(context, config);
    const modeLower = mode?.toLowerCase() ?? '';
    const storageScope =
      config.storageScope ??
      (modeLower === 'dispatcher' || modeLower === 'liveappstudio' || modeLower === 'agentappstudio'
        ? 'agentic_os'
        : 'workspace');

    if (!workspacePath && storageScope !== 'agentic_os') {
      throw new Error('Workspace path is required to create a session');
    }

    const sessionMode = normalizeSessionDisplayMode(mode, workspace);
    const agentType = resolveAgentType(mode, workspace);

    const creationKey =
      storageScope === 'agentic_os'
        ? 'agentic_os'
        : workspace?.id?.trim()
        ? workspace.id
        : workspacePath ?? 'agentic_os';

    const pendingCreation = pendingSessionCreations.get(creationKey);
    if (pendingCreation) {
      return pendingCreation;
    }

    const sameModeCount =
      Array.from(context.flowChatStore.getState().sessions.values()).filter(
        session => normalizeSessionDisplayMode(session.mode) === sessionMode
      ).length + 1;
    const sessionName =
      sessionMode === 'cowork'
        ? i18nService.t('flow-chat:session.newCoworkWithIndex', { count: sameModeCount })
        : sessionMode === 'design'
          ? i18nService.t('flow-chat:session.newDesignWithIndex', { count: sameModeCount })
          : sessionMode === 'dispatcher'
              ? i18nService.t('flow-chat:session.dispatcher')
              : sessionMode === 'liveappstudio'
                ? i18nService.t('flow-chat:session.newLiveAppStudioWithIndex', { count: sameModeCount })
                : sessionMode === 'agentappstudio'
                  ? i18nService.t('flow-chat:session.newAgentAppStudioWithIndex', { count: sameModeCount })
                  : i18nService.t('flow-chat:session.newCodeWithIndex', { count: sameModeCount });
    
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
        agentType,
        workspacePath || undefined,
        storageScope
      );

      useWorkspaceSurfaceStore.getState().openSurface(
        sessionMode === 'dispatcher'
          ? { kind: 'dispatcher-home', dispatcherSessionId: response.sessionId }
          : { kind: 'session', sessionId: response.sessionId }
      );

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
 * Switch to specified session
 */
export async function switchChatSession(
  context: FlowChatContext,
  sessionId: string
): Promise<void> {
  try {
    const session = context.flowChatStore.getState().sessions.get(sessionId);

    // Switch UI immediately so the user sees the new session without waiting for history load.
    context.flowChatStore.switchSession(sessionId);

    touchSessionActivity(
      sessionId,
      session?.workspacePath,
      session?.storageScope
    ).catch(error => {
      log.debug('Failed to touch session activity', { sessionId, error });
    });

    if (session?.isHistorical) {
      // Load history in the background — do not block the UI.
      void hydrateHistoricalSession(context, sessionId, true);
    }
  } catch (error) {
    log.error('Failed to switch chat session', { sessionId, error });
    notificationService.error('Failed to switch session', {
      duration: 3000
    });
    throw error;
  }
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
  } catch (error) {
    log.error('Failed to delete chat session', { sessionId, error });
    notificationService.error('Failed to delete session', {
      duration: 3000
    });
    throw error;
  }
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
      sourceSession.mode,
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

  if (session.isHistorical) {
    await hydrateHistoricalSession(context, sessionId, false);
  }

  const latestSession = context.flowChatStore.getState().sessions.get(sessionId) ?? session;
  const workspacePath = requireSessionWorkspacePath(
    latestSession.workspacePath,
    sessionId,
    latestSession.storageScope
  );

  const isHistoricalSession = latestSession.isHistorical === true;
  const isFirstTurn = latestSession.dialogTurns.length <= 1;
  const needsBackendSetup = isHistoricalSession || isFirstTurn;
  /** Avoid createSession when historical data is already loaded but backend files are missing (e.g. new SSH connection id). */
  const allowRecreateOnCoordinatorFailure =
    needsBackendSetup && !(isHistoricalSession && latestSession.dialogTurns.length > 1);

  const clearHistoricalFlag = () => {
    if (!isHistoricalSession) return;
    context.flowChatStore.setState(prev => {
      const newSessions = new Map(prev.sessions);
      const sess = newSessions.get(sessionId);
      if (sess) {
        newSessions.set(sessionId, { ...sess, isHistorical: false });
      }
      return { ...prev, sessions: newSessions };
    });
  };

  try {
    await agentAPI.ensureCoordinatorSession({
      sessionId,
      workspacePath,
      storageScope: latestSession.storageScope,
    });
    clearHistoricalFlag();
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
      agentType: latestSession.mode || 'agentic',
      workspacePath,
      storageScope: latestSession.storageScope,
      config: {
        modelName: latestSession.config.modelName || 'primary',
        enableTools: true,
        safeMode: true,
        storageScope: latestSession.storageScope,
      }
    });
    clearHistoricalFlag();
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
    agentType: session.mode || 'agentic',
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
