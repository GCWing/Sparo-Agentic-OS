/**
 * Flow Chat unified manager
 * Integrates Agent management and Flow Chat UI state management
 * 
 * Refactoring note:
 * This file is the main entry point, responsible for singleton management, initialization, and module coordination
 * Specific functionality is split into modules under flow-chat-manager/
 */

import { processingStatusManager } from './ProcessingStatusManager';
import { FlowChatStore } from '../store/FlowChatStore';
import { AgentService } from '../../shared/services/agent-service';
import { stateMachineManager } from '../state-machine';
import { EventBatcher } from './EventBatcher';
import { createLogger } from '@/shared/utils/logger';
import type { WorkspaceInfo } from '@/shared/types';
import { useWorkspaceSurfaceStore, selectFocusedSessionId } from '@/app/navigation/workspaceSurfaceStore';
import { openSession } from '@/app/navigation/navigationController';
import {
  compareSessionsForDisplay,
  sessionBelongsToWorkspaceNavRow,
} from '../utils/sessionOrdering';
import { sessionMatchesWorkspace } from '../utils/workspaceScope';

import type { FlowChatContext, SessionConfig, DialogTurn } from './flow-chat-manager/types';
import {
  saveAllInProgressTurns,
  immediateSaveDialogTurn,
  createChatSession as createChatSessionModule,
  activateSessionData as activateSessionDataModule,
  deleteChatSession as deleteChatSessionModule,
  retargetEmptyChatSessionWorkspace as retargetEmptyChatSessionWorkspaceModule,
  renameChatSessionTitle as renameChatSessionTitleModule,
  forkChatSession as forkChatSessionModule,
  cleanupSaveState,
  cleanupSessionBuffers,
  sendMessage as sendMessageModule,
  cancelCurrentTask as cancelCurrentTaskModule,
  cancelTaskForSession as cancelTaskForSessionModule,
  initializeEventListeners,
  processBatchedEvents,
  addDialogTurn as addDialogTurnModule,
  addImageAnalysisPhase as addImageAnalysisPhaseModule,
  updateImageAnalysisResults as updateImageAnalysisResultsModule,
  updateImageAnalysisItem as updateImageAnalysisItemModule,
  updateSessionMetadata,
} from './flow-chat-manager';
import { scheduleToolCardRegistrySyncFromBackendManifest } from '../tool-cards/ToolManifestSync';
import {
  isSystemAgenticOsSession,
  type SessionDescriptor,
} from '../domain/sessionDescriptor';
import { canHydrateSession } from '../domain/sessionLoadPhase';
import { resolveProfile, resolveSessionTypeDefinitionForDescriptor } from '@/app/session-profiles';

const log = createLogger('FlowChatManager');
const RECENT_WORKSPACE_PRELOAD_LIMIT = 7;
const WARM_HISTORY_SESSION_LIMIT = 0;
const WARM_AGENTIC_OS_SESSION_LIMIT = 0;
const PRELOAD_WORKSPACE_CONCURRENCY = 2;

type PreloadWorkspaceScope = Pick<WorkspaceInfo, 'id' | 'name' | 'rootPath'>;

interface FlowChatInitializationResult {
  workspacePath: string;
  hasWorkspaceSessions: boolean;
  focusedSessionId: string | null;
  hasFocusedWorkspaceSession: boolean;
}

interface EnsureWorkspaceSessionOptions {
  preferredDescriptor?: SessionDescriptor;
  storageScope?: import('@/shared/types/session-history').SessionStorageScope;
  skipAutoSelectSession?: boolean;
  createDefaultSession?: boolean;
  defaultSessionConfig?: SessionConfig;
  defaultSessionDescriptor?: SessionDescriptor;
}

export class FlowChatManager {
  private static instance: FlowChatManager;
  private context: FlowChatContext;
  private agentService: AgentService;
  private eventListenerInitialized = false;
  private eventListenerCleanup: (() => void) | null = null;

  private constructor() {
    this.context = {
      flowChatStore: FlowChatStore.getInstance(),
      processingManager: processingStatusManager,
      eventBatcher: new EventBatcher({
        onFlush: (events) => this.processBatchedEvents(events)
      }),
      toolParamBuffers: new Map(),
      toolParamParseTimestamps: new Map(),
      pendingTurnCompletions: new Map(),
      pendingHistoryLoads: new Map(),
      contentBuffers: new Map(),
      activeTextItems: new Map(),
      saveDebouncers: new Map(),
      lastSaveTimestamps: new Map(),
      lastSaveHashes: new Map(),
      turnSaveInFlight: new Map(),
      turnSavePending: new Set(),
      workspaceContextPath: null
    };
    
    this.agentService = AgentService.getInstance();
  }

  public static getInstance(): FlowChatManager {
    if (!FlowChatManager.instance) {
      FlowChatManager.instance = new FlowChatManager();
    }
    return FlowChatManager.instance;
  }

  async initialize(
    workspacePath: string,
    preferredDescriptor?: SessionDescriptor,
    storageScope?: import('@/shared/types/session-history').SessionStorageScope,
    options?: {
      skipAutoSelectSession?: boolean;
    }
  ): Promise<FlowChatInitializationResult> {
    try {
      scheduleToolCardRegistrySyncFromBackendManifest();
      await this.initializeEventListeners();

      this.context.flowChatStore.registerPersistUnreadCompletionCallback(
        (sessionId, value) => {
          updateSessionMetadata(this.context, sessionId).catch(err => {
            log.warn('Failed to persist unread completion change', { sessionId, value, err });
          });
        }
      );

      await this.context.flowChatStore.initializeFromDisk(workspacePath, storageScope);

      const state = this.context.flowChatStore.getState();
      const workspaceSessions = Array.from(state.sessions.values()).filter(session =>
        this.sessionMatchesWorkspaceRow(session, workspacePath)
      );
      const hasWorkspaceSessions = workspaceSessions.length > 0;
      const focusedSessionId = selectFocusedSessionId(useWorkspaceSurfaceStore.getState());
      const focusedSession = focusedSessionId
        ? state.sessions.get(focusedSessionId) ?? null
        : null;
      const focusedSessionBelongsToWorkspace =
        !!focusedSession && this.sessionMatchesWorkspaceRow(focusedSession, workspacePath);

      if (
        hasWorkspaceSessions &&
        !focusedSessionBelongsToWorkspace &&
        !options?.skipAutoSelectSession
      ) {
        const sortedWorkspaceSessions = [...workspaceSessions].sort(compareSessionsForDisplay);
        const preferredDisplayMode = preferredDescriptor
          ? resolveSessionTypeDefinitionForDescriptor(preferredDescriptor).lifecycle.displayMode
          : null;
        const latestSession = (preferredDescriptor
          ? sortedWorkspaceSessions.find(session =>
              resolveSessionTypeDefinitionForDescriptor(session.descriptor).lifecycle.displayMode === preferredDisplayMode
            )
          : undefined) || sortedWorkspaceSessions[0];

        if (!latestSession) {
          this.context.workspaceContextPath = workspacePath;
          return this.buildInitializationResult(workspacePath, hasWorkspaceSessions);
        }

        if (canHydrateSession(latestSession)) {
          await this.context.flowChatStore.loadSessionHistory(
            latestSession.sessionId,
            workspacePath,
            undefined,
            latestSession.storageScope
          );
        }

        this.context.flowChatStore.switchSession(latestSession.sessionId);
        await openSession(latestSession.sessionId);
      }

      this.context.workspaceContextPath = workspacePath;

      return this.buildInitializationResult(workspacePath, hasWorkspaceSessions);
    } catch (error) {
      log.error('Initialization failed', error);
      throw error;
    }
  }

  async initializeWorkspaceSessionState(
    workspacePath: string,
    options?: EnsureWorkspaceSessionOptions
  ): Promise<FlowChatInitializationResult & { createdSessionId?: string }> {
    const result = await this.initialize(
      workspacePath,
      options?.preferredDescriptor,
      options?.storageScope,
      { skipAutoSelectSession: options?.skipAutoSelectSession }
    );

    if (
      options?.createDefaultSession &&
      (!result.hasWorkspaceSessions || !result.hasFocusedWorkspaceSession)
    ) {
      const createdSessionId = await this.createChatSession(
        {
          ...(options.defaultSessionConfig ?? {}),
          navigate: options.skipAutoSelectSession
            ? false
            : options.defaultSessionConfig?.navigate,
        },
        options.defaultSessionDescriptor ?? options.preferredDescriptor
      );
      return {
        ...this.buildInitializationResult(workspacePath, true),
        createdSessionId,
      };
    }

    return result;
  }

  private sessionMatchesWorkspaceRow(
    session: { workspacePath?: string },
    workspacePath: string
  ): boolean {
    const sp = session.workspacePath || workspacePath;
    return sessionBelongsToWorkspaceNavRow(
      { workspacePath: sp },
      workspacePath
    );
  }

  private buildInitializationResult(
    workspacePath: string,
    hasWorkspaceSessions: boolean
  ): FlowChatInitializationResult {
    const state = this.context.flowChatStore.getState();
    const focusedSessionId = selectFocusedSessionId(useWorkspaceSurfaceStore.getState());
    const focusedSession = focusedSessionId
      ? state.sessions.get(focusedSessionId) ?? null
      : null;
    return {
      workspacePath,
      hasWorkspaceSessions,
      focusedSessionId,
      hasFocusedWorkspaceSession:
        !!focusedSession && this.sessionMatchesWorkspaceRow(focusedSession, workspacePath),
    };
  }

  private async initializeEventListeners(): Promise<void> {
    if (this.eventListenerInitialized) {
      return;
    }

    this.eventListenerCleanup = await initializeEventListeners(
      this.context,
      (sessionId, turnId, result) => this.handleTodoWriteResult(sessionId, turnId, result)
    );
    
    this.eventListenerInitialized = true;
  }

  public async preloadRecentWorkspaceSessions(
    workspaces: PreloadWorkspaceScope[],
    options?: {
      metadataLimit?: number;
      warmHistoryCount?: number;
      warmAgenticOsCount?: number;
      force?: boolean;
    }
  ): Promise<{
    attemptedWorkspaceCount: number;
    metadataLoadedCount: number;
    warmedSessionCount: number;
    warmedAgenticOsCount: number;
    failedWorkspaces: string[];
  }> {
    const metadataLimit = options?.metadataLimit ?? RECENT_WORKSPACE_PRELOAD_LIMIT;
    const warmHistoryCount = options?.warmHistoryCount ?? WARM_HISTORY_SESSION_LIMIT;
    const warmAgenticOsCount = options?.warmAgenticOsCount ?? WARM_AGENTIC_OS_SESSION_LIMIT;
    const scopedWorkspaces = workspaces.slice(0, metadataLimit);
    const failedWorkspaces: string[] = [];
    let metadataLoadedCount = 0;

    const runPreload = async (workspace: PreloadWorkspaceScope) => {
      if (
        !options?.force &&
        this.context.flowChatStore.hasWorkspaceMetadataPreloaded(workspace.rootPath)
      ) {
        return;
      }

      try {
        const { sessionAPI } = await import('@/infrastructure/api');
        const metadata = await sessionAPI.listSessions(workspace.rootPath, 'workspace');
        const inserted = await this.context.flowChatStore.hydrateWorkspaceSessionsMetadata(
          metadata,
          workspace.rootPath,
          'workspace'
        );
        metadataLoadedCount += inserted;
      } catch (error) {
        failedWorkspaces.push(workspace.name || workspace.rootPath);
        log.warn('Failed to preload workspace sessions', {
          workspaceId: workspace.id,
          workspacePath: workspace.rootPath,
          error,
        });
      }
    };

    for (let index = 0; index < scopedWorkspaces.length; index += PRELOAD_WORKSPACE_CONCURRENCY) {
      const batch = scopedWorkspaces.slice(index, index + PRELOAD_WORKSPACE_CONCURRENCY);
      await Promise.all(batch.map(runPreload));
    }

    let warmedSessionCount = 0;
    let warmedAgenticOsCount = 0;

    if (warmHistoryCount > 0) {
      const warmedSessionCandidates = Array.from(this.context.flowChatStore.getState().sessions.values())
        .filter(session => {
          if (!canHydrateSession(session)) return false;
          if (isSystemAgenticOsSession(session.descriptor)) return false;
          if (this.context.flowChatStore.hasSessionHistoryWarmed(session.sessionId)) return false;
          return scopedWorkspaces.some(workspace => sessionMatchesWorkspace(session, workspace));
        })
        .sort(compareSessionsForDisplay)
        .slice(0, warmHistoryCount);

      await Promise.allSettled(
        warmedSessionCandidates.map(async session => {
          const workspacePath = session.workspacePath;
          if (!workspacePath) return;
          try {
            await this.context.flowChatStore.loadSessionHistory(
              session.sessionId,
              workspacePath,
              undefined,
              session.storageScope
            );
            warmedSessionCount += 1;
          } catch (error) {
            log.warn('Failed to warm historical session', {
              sessionId: session.sessionId,
              workspacePath,
              error,
            });
          }
        })
      );
    }

    if (warmAgenticOsCount > 0) {
      const warmedAgenticOsCandidates = Array.from(this.context.flowChatStore.getState().sessions.values())
        .filter(session => {
          if (!canHydrateSession(session)) return false;
          if (!isSystemAgenticOsSession(session.descriptor)) return false;
          if (this.context.flowChatStore.hasSessionHistoryWarmed(session.sessionId)) return false;
          return true;
        })
        .sort(compareSessionsForDisplay)
        .slice(0, warmAgenticOsCount);

      await Promise.allSettled(
        warmedAgenticOsCandidates.map(async session => {
          const workspacePath = session.workspacePath;
          if (!workspacePath) return;
          try {
            await this.context.flowChatStore.loadSessionHistory(
              session.sessionId,
              workspacePath,
              undefined,
              session.storageScope
            );
            warmedAgenticOsCount += 1;
          } catch (error) {
            log.warn('Failed to warm Agentic OS session', {
              sessionId: session.sessionId,
              workspacePath,
              error,
            });
          }
        })
      );
    }

    return {
      attemptedWorkspaceCount: scopedWorkspaces.length,
      metadataLoadedCount,
      warmedSessionCount,
      warmedAgenticOsCount,
      failedWorkspaces,
    };
  }

  public async preloadAgenticOsSessions(options?: {
    warmAgenticOsCount?: number;
  }): Promise<{ metadataLoadedCount: number; warmedAgenticOsCount: number }> {
    const warmAgenticOsCount = options?.warmAgenticOsCount ?? WARM_AGENTIC_OS_SESSION_LIMIT;
    const { sessionAPI } = await import('@/infrastructure/api');
    const metadata = await sessionAPI.listSessions(undefined, 'agentic_os');
    const metadataLoadedCount = await this.context.flowChatStore.hydrateWorkspaceSessionsMetadata(
      metadata,
      '',
      'agentic_os'
    );
    if (warmAgenticOsCount <= 0) {
      return { metadataLoadedCount, warmedAgenticOsCount: 0 };
    }
    const candidates = Array.from(this.context.flowChatStore.getState().sessions.values())
      .filter(session =>
        isSystemAgenticOsSession(session.descriptor) &&
        canHydrateSession(session) &&
        !this.context.flowChatStore.hasSessionHistoryWarmed(session.sessionId)
      )
      .sort(compareSessionsForDisplay)
      .slice(0, warmAgenticOsCount);
    let warmedAgenticOsCount = 0;
    await Promise.allSettled(
      candidates.map(async session => {
        await this.context.flowChatStore.loadSessionHistory(
          session.sessionId,
          session.workspacePath || '',
          undefined,
          'agentic_os'
        );
        warmedAgenticOsCount += 1;
      })
    );
    return { metadataLoadedCount, warmedAgenticOsCount };
  }

  public cleanupEventListeners(): void {
    if (this.eventListenerCleanup) {
      this.eventListenerCleanup();
      this.eventListenerCleanup = null;
      this.eventListenerInitialized = false;
    }
  }

  private processBatchedEvents(events: Array<{ key: string; payload: any }>): void {
    processBatchedEvents(
      this.context,
      events,
      (sessionId, turnId, result) => this.handleTodoWriteResult(sessionId, turnId, result)
    );
  }

  async createChatSession(config: SessionConfig, descriptor?: SessionDescriptor): Promise<string> {
    return createChatSessionModule(this.context, config, descriptor);
  }

  async switchChatSession(sessionId: string): Promise<void> {
    const { openSession: openSessionNav } = await import('@/app/navigation/navigationController');
    await openSessionNav(sessionId);
  }

  async activateSessionData(sessionId: string): Promise<void> {
    return activateSessionDataModule(this.context, sessionId);
  }

  async persistSessionMetadata(sessionId: string): Promise<void> {
    return updateSessionMetadata(this.context, sessionId);
  }

  async deleteChatSession(sessionId: string): Promise<void> {
    return deleteChatSessionModule(this.context, sessionId);
  }

  async renameChatSessionTitle(sessionId: string, title: string): Promise<string> {
    return renameChatSessionTitleModule(this.context, sessionId, title);
  }

  async forkChatSession(sourceSessionId: string, sourceTurnId: string): Promise<string> {
    return forkChatSessionModule(this.context, sourceSessionId, sourceTurnId);
  }

  async resetWorkspaceSessions(
    workspace: Pick<WorkspaceInfo, 'id' | 'rootPath'>,
    options?: {
      reinitialize?: boolean;
      preferredDescriptor?: SessionDescriptor;
    }
  ): Promise<void> {
    const workspacePath = workspace.rootPath;
    const removedSessionIds = this.context.flowChatStore.removeSessionsForWorkspace(workspace);
    useWorkspaceSurfaceStore.getState().forgetSessions(removedSessionIds);

    removedSessionIds.forEach(sessionId => {
      stateMachineManager.delete(sessionId);
      this.context.processingManager.clearSessionStatus(sessionId);
      cleanupSaveState(this.context, sessionId);
      cleanupSessionBuffers(this.context, sessionId);
    });

    if (!options?.reinitialize) {
      return;
    }

    await this.initializeWorkspaceSessionState(workspacePath, {
      preferredDescriptor: options.preferredDescriptor,
      createDefaultSession: true,
      defaultSessionConfig: {
        workspacePath,
        workspaceId: workspace.id,
      },
      defaultSessionDescriptor: options.preferredDescriptor,
    });
  }

  async retargetEmptySessionWorkspace(
    sessionId: string,
    workspace: Pick<WorkspaceInfo, 'id' | 'rootPath'>,
    options?: {
      preferredDescriptor?: SessionDescriptor;
    }
  ): Promise<string> {
    return retargetEmptyChatSessionWorkspaceModule(
      this.context,
      sessionId,
      workspace,
      options?.preferredDescriptor
    );
  }

  async sendMessage(
    message: string,
    sessionId?: string,
    displayMessage?: string,
    agentType?: string,
    switchToMode?: string,
    options?: {
      imageContexts?: import('@/infrastructure/api/service-api/ImageContextTypes').ImageContextData[];
      imageDisplayData?: Array<{ id: string; name: string; dataUrl?: string; imagePath?: string; mimeType?: string }>;
      persistAgentType?: boolean;
      systemReminderOverride?: string;
      metadata?: Record<string, any>;
      triggerSource?: import('@/shared/types/session-history').TriggerSource;
      localDialogTurnId?: string;
    }
  ): Promise<void> {
    const surfaceState = useWorkspaceSurfaceStore.getState();
    const targetSessionId =
      sessionId ||
      selectFocusedSessionId(surfaceState);
    
    if (!targetSessionId) {
      throw new Error('No active session');
    }

    const contextualOptions = this.withBoundSessionContext(targetSessionId, options);

    return sendMessageModule(
      this.context,
      message,
      targetSessionId,
      displayMessage,
      agentType,
      switchToMode,
      contextualOptions
    );
  }

  private withBoundSessionContext(
    sessionId: string,
    options?: {
      imageContexts?: import('@/infrastructure/api/service-api/ImageContextTypes').ImageContextData[];
      imageDisplayData?: Array<{ id: string; name: string; dataUrl?: string; imagePath?: string; mimeType?: string }>;
      persistAgentType?: boolean;
      systemReminderOverride?: string;
      metadata?: Record<string, any>;
      triggerSource?: import('@/shared/types/session-history').TriggerSource;
      localDialogTurnId?: string;
    }
  ): typeof options {
    const session = this.context.flowChatStore.getState().sessions.get(sessionId);
    const binding = session?.customMetadata?.agentSessionBinding;
    if (!session || !binding) {
      return options;
    }

    const profile = resolveProfile(session.descriptor.profileId);
    const hint = profile.buildAgentContextHint?.(session, binding);
    if (!hint) {
      return options;
    }

    const baseReminder = options?.systemReminderOverride?.trim();
    const hintReminder = hint.systemReminder?.trim();
    const systemReminderOverride = [baseReminder, hintReminder]
      .filter(Boolean)
      .join('\n\n') || undefined;

    return {
      ...(options || {}),
      systemReminderOverride,
      metadata: {
        ...(hint.metadata || {}),
        ...(options?.metadata || {}),
      },
    };
  }

  async cancelCurrentTask(): Promise<boolean> {
    return cancelCurrentTaskModule(this.context);
  }

  async cancelTaskForSession(sessionId: string): Promise<boolean> {
    return cancelTaskForSessionModule(this.context, sessionId);
  }

  public async saveAllInProgressTurns(): Promise<void> {
    return saveAllInProgressTurns(this.context);
  }

  /**
   * Save a specific dialog turn to disk.
   * Used when tool call data is updated after the turn has completed (e.g. mermaid code fix).
   */
  public async saveDialogTurn(sessionId: string, turnId: string): Promise<void> {
    return immediateSaveDialogTurn(this.context, sessionId, turnId, true);
  }

  addDialogTurn(sessionId: string, dialogTurn: DialogTurn): void {
    addDialogTurnModule(this.context, sessionId, dialogTurn);
  }

  addImageAnalysisPhase(
    sessionId: string,
    dialogTurnId: string,
    imageContexts: import('@/shared/types/context').ImageContext[]
  ): void {
    addImageAnalysisPhaseModule(this.context, sessionId, dialogTurnId, imageContexts);
  }

  updateImageAnalysisResults(
    sessionId: string,
    dialogTurnId: string,
    results: import('../types/flow-chat').ImageAnalysisResult[]
  ): void {
    updateImageAnalysisResultsModule(this.context, sessionId, dialogTurnId, results);
  }

  updateImageAnalysisItem(
    sessionId: string,
    dialogTurnId: string,
    imageId: string,
    updates: { status?: 'analyzing' | 'completed' | 'error'; error?: string; result?: any }
  ): void {
    updateImageAnalysisItemModule(this.context, sessionId, dialogTurnId, imageId, updates);
  }

  async getAvailableAgents(): Promise<string[]> {
    return this.agentService.getAvailableAgents();
  }

  getCurrentSession() {
    const sessionId = selectFocusedSessionId(useWorkspaceSurfaceStore.getState());
    return sessionId
      ? this.context.flowChatStore.getState().sessions.get(sessionId) ?? null
      : null;
  }

  getAllProcessingStatuses() {
    return this.context.processingManager.getAllStatuses();
  }

  onProcessingStatusChange(callback: (statuses: any[]) => void) {
    return this.context.processingManager.addListener(callback);
  }

  getSessionIdByTaskId(taskId: string): string | undefined {
    return taskId;
  }

  private handleTodoWriteResult(sessionId: string, turnId: string, result: any): void {
    try {
      if (!result.todos || !Array.isArray(result.todos)) {
        log.debug('TodoWrite result missing todos array', { sessionId, turnId });
        return;
      }

      const incomingTodos: import('../types/flow-chat').TodoItem[] = result.todos.map((todo: any) => ({
        id: todo.id,
        content: todo.content,
        status: todo.status,
      }));

      if (result.merge) {
        const existingTodos = this.context.flowChatStore.getDialogTurnTodos(sessionId, turnId);
        const todoMap = new Map<string, import('../types/flow-chat').TodoItem>();
        
        existingTodos.forEach(todo => {
          todoMap.set(todo.id, todo);
        });
        
        incomingTodos.forEach(todo => {
          todoMap.set(todo.id, todo);
        });
        
        const mergedTodos = Array.from(todoMap.values());
        this.context.flowChatStore.setDialogTurnTodos(sessionId, turnId, mergedTodos);
      } else {
        this.context.flowChatStore.setDialogTurnTodos(sessionId, turnId, incomingTodos);
      }
      
      this.syncTodosToStateMachine(sessionId);
      
      window.dispatchEvent(new CustomEvent('sparo:todowrite-update', {
        detail: {
          sessionId,
          turnId,
          todos: incomingTodos,
          merge: result.merge
        }
      }));
    } catch (error) {
      log.error('Failed to handle TodoWrite result', { sessionId, turnId, error });
    }
  }

  private syncTodosToStateMachine(sessionId: string): void {
    const machine = stateMachineManager.get(sessionId);
    if (!machine) return;
    
    const todos = this.context.flowChatStore.getTodos(sessionId);
    const context = machine.getContext();
    
    const plannerTodos = todos.map(todo => ({
      id: todo.id,
      content: todo.content,
      status: todo.status,
    }));
    
    if (context) {
      context.planner = {
        todos: plannerTodos,
        isActive: todos.length > 0
      };
    }
  }
}
export const flowChatManager = FlowChatManager.getInstance();
export default flowChatManager;
