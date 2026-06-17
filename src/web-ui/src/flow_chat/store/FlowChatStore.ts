/**
 * Flow Chat global state store
 * Prevents state loss when components remount
 */

import {
  FlowChatState,
  Session,
  DialogTurn,
  ModelRound,
  FlowItem,
  FlowImageAnalysisItem,
  ImageAnalysisResult,
  AnyFlowItem,
  FlowToolItem,
  SessionConfig,
} from '../types/flow-chat';
import { createLogger } from '@/shared/utils/logger';
import { i18nService } from '@/infrastructure/i18n/core/I18nService';
import type { SessionKind, SessionStorageScope, SessionMetadata } from '@/shared/types/session-history';
import {
  deriveLastFinishedAtFromMetadata,
  deriveSessionRelationshipFromMetadata,
  isLegacyPersistedBtwSession,
  normalizeSessionRelationship,
} from '../utils/sessionMetadata';
import {
  isTransientToolStatus,
  normalizeRecoveredRoundStatus,
  normalizeRecoveredTextStatus,
  normalizeRecoveredThinkingStatus,
  normalizeRecoveredToolStatus,
  normalizeRecoveredTurnStatus,
} from '../utils/dialogTurnStability';
import { finalizeFlowTurn } from '../runtime/finalizers';
import type { ToolRuntimeState } from '../runtime/statusModel';
import type { WorkspaceInfo } from '@/shared/types';
import { sessionBelongsToWorkspaceNavRow } from '../utils/sessionOrdering';
import { sessionMatchesWorkspace } from '../utils/workspaceScope';
import { incrementFlowChatCounter, measureFlowChat } from '../performance/flowChatPerf';
import { getProjectionVersion as getProjectionSchedulerVersion } from '../projections/flowChatProjectionScheduler';
import {
  descriptorFromAgentType,
  getBackendAgentType,
  getDefaultSessionDescriptor,
  isEvolutionLabSession,
  isSystemAgenticOsSession,
  withActiveAgentId,
  type SessionDescriptor,
} from '../domain/sessionDescriptor';

const log = createLogger('FlowChatStore');

type ToolItemLocation = {
  sessionId: string;
  dialogTurnId: string;
  itemId: string;
  item: FlowItem;
};

export interface FlowChatSessionHeader {
  sessionId: string;
  title?: string;
  titleStatus?: Session['titleStatus'];
  status?: Session['status'];
  descriptor: SessionDescriptor;
  lastActiveAt?: number;
  lastFinishedAt?: number;
  isHistorical?: boolean;
  isTransient?: boolean;
  parentSessionId?: string;
  sessionKind?: SessionKind;
  workspacePath?: string;
  storageScope?: SessionStorageScope;
}

export interface FlowChatActiveTurnTail {
  sessionId: string;
  turnId: string;
  turnStatus: DialogTurn['status'];
  roundId?: string;
  itemId?: string;
  itemType?: FlowItem['type'];
  itemStatus?: FlowItem['status'];
  contentLength: number;
}

const objectIs = <T>(left: T, right: T): boolean => Object.is(left, right);

function recoverToolRuntime(
  tool: any,
  status: FlowToolItem['status'],
): ToolRuntimeState {
  if (tool.runtime && typeof tool.runtime === 'object') {
    return tool.runtime as ToolRuntimeState;
  }

  const lifecycle: ToolRuntimeState['lifecycle'] =
    status === 'pending_confirmation'
      ? 'waiting_confirmation'
      : status === 'confirmed'
        ? 'ready'
        : status === 'completed' || status === 'cancelled' || status === 'error'
          ? status
          : status === 'running'
            ? 'running'
            : status === 'pending'
              ? 'pending'
              : 'preparing';

  return {
    lifecycle,
    inputPhase: tool.toolCall?.input !== undefined ? 'parsed' : 'none',
    confirmation:
      lifecycle === 'waiting_confirmation'
        ? 'required'
        : status === 'confirmed'
          ? 'approved'
          : 'none',
    input: tool.toolCall?.input,
    result: tool.toolResult?.result,
    error: tool.toolResult?.error,
    startedAt: tool.startTime,
    endedAt: tool.endTime,
  };
}

/** Ensures system/evolution sessions delete from the global Agentic OS persistence namespace. */
function resolveSessionDeleteStorageScope(session: Session): SessionStorageScope {
  return (
    session.storageScope ??
    session.config?.storageScope ??
    (isSystemAgenticOsSession(session.descriptor) || isEvolutionLabSession(session.descriptor)
      ? 'agentic_os'
      : 'workspace')
  );
}

export class FlowChatStore {
  private static instance: FlowChatStore;
  private state: FlowChatState;
  private listeners: Set<(state: FlowChatState) => void> = new Set();
  private toolItemIndex = new Map<string, Omit<ToolItemLocation, 'item'>>();
  private metadataPreloadedWorkspaceScopes = new Set<string>();
  private warmedSessionIds = new Set<string>();
  private onPersistUnreadCompletion?: (sessionId: string, value: 'completed' | 'error' | 'interrupted' | undefined) => void;
  
  private silentMode = false;

  private constructor() {
    this.clearOldStorage();
    this.state = {
      sessions: new Map(),
      activeSessionId: null
    };
  }

  private clearOldStorage(): void {
    try {
      const keysToRemove = [
        'sparo-flow-chat-state',
        'sparo-flow-chat-global',
        'sparo-session-ids'
      ];
      
      keysToRemove.forEach(key => {
        if (localStorage.getItem(key)) {
          localStorage.removeItem(key);
        }
      });

      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('sparo-session-')) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      log.warn('Failed to clear old storage data', error);
    }
  }


  public static getInstance(): FlowChatStore {
    if (!FlowChatStore.instance) {
      FlowChatStore.instance = new FlowChatStore();
    }
    return FlowChatStore.instance;
  }

  public getState(): FlowChatState {
    return this.state;
  }

  public getSessionHeader(sessionId: string): FlowChatSessionHeader | null {
    const session = this.state.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    return {
      sessionId: session.sessionId,
      title: session.title,
      titleStatus: session.titleStatus,
      status: session.status,
      descriptor: session.descriptor,
      lastActiveAt: session.lastActiveAt,
      lastFinishedAt: session.lastFinishedAt,
      isHistorical: session.isHistorical,
      isTransient: session.isTransient,
      parentSessionId: session.parentSessionId,
      sessionKind: session.sessionKind,
      workspacePath: session.workspacePath,
      storageScope: session.storageScope,
    };
  }

  public getActiveTurnTail(sessionId: string): FlowChatActiveTurnTail | null {
    const session = this.state.sessions.get(sessionId);
    const turn = session?.dialogTurns[session.dialogTurns.length - 1];
    if (!session || !turn) {
      return null;
    }

    const round = turn.modelRounds[turn.modelRounds.length - 1];
    const item = round?.items[round.items.length - 1];
    const content = item && (item.type === 'text' || item.type === 'thinking')
      ? (item as { content?: string }).content ?? ''
      : '';

    return {
      sessionId,
      turnId: turn.id,
      turnStatus: turn.status,
      roundId: round?.id,
      itemId: item?.id,
      itemType: item?.type,
      itemStatus: item?.status,
      contentLength: content.length,
    };
  }

  public getToolRuntime(toolUseId: string): ToolRuntimeState | null {
    const location = this.findToolItemLocation(toolUseId);
    if (!location || location.item.type !== 'tool') {
      return null;
    }

    const toolItem = location.item as FlowToolItem;
    return recoverToolRuntime(toolItem, toolItem.status);
  }

  public getProjectionVersion(surfaceId: string | null | undefined): number {
    return getProjectionSchedulerVersion(surfaceId);
  }

  public setState(updater: (prevState: FlowChatState) => FlowChatState): void {
    const previousState = this.state;
    const newState = updater(this.state);
    this.syncToolIndexForStateChange(previousState, newState);
    this.state = newState;
    
    if (!this.silentMode) {
      measureFlowChat('store.notify', () => this.listeners.forEach(listener => {
        try {
          listener(newState);
        } catch (error) {
          console.error('[FlowChatStore] Listener threw an error, skipping:', error);
        }
      }));
    }
  }
  
  /**
   * Silent state update (does not trigger listeners)
   * Used for batch updates, call notifyListeners() after completion
   */
  public setStateSilent(updater: (prevState: FlowChatState) => FlowChatState): void {
    const prevSilentMode = this.silentMode;
    this.silentMode = true;
    try {
      this.setState(updater);
    } finally {
      this.silentMode = prevSilentMode;
    }
  }
  
  /**
   * Manually notify all listeners (call after batch updates complete)
   */
  public notifyListeners(): void {
    measureFlowChat('store.notify', () => this.listeners.forEach(listener => {
      try {
        listener(this.state);
      } catch (error) {
        console.error('[FlowChatStore] Listener threw an error during notifyListeners, skipping:', error);
      }
    }));
  }
  
  public beginSilentMode(): void {
    this.silentMode = true;
  }
  
  public endSilentMode(): void {
    this.silentMode = false;
    this.notifyListeners();
  }

  private getWorkspaceScopeKey(workspacePath: string): string {
    return workspacePath.trim();
  }

  public hasWorkspaceMetadataPreloaded(workspacePath: string): boolean {
    return this.metadataPreloadedWorkspaceScopes.has(this.getWorkspaceScopeKey(workspacePath));
  }

  public markWorkspaceMetadataPreloaded(workspacePath: string): void {
    this.metadataPreloadedWorkspaceScopes.add(this.getWorkspaceScopeKey(workspacePath));
  }

  public hasSessionHistoryWarmed(sessionId: string): boolean {
    return this.warmedSessionIds.has(sessionId);
  }

  public markSessionHistoryWarmed(sessionId: string): void {
    this.warmedSessionIds.add(sessionId);
  }

  private collectCascadeSessionIds(
    rootSessionId: string,
    sessions: Map<string, Session>
  ): string[] {
    if (!sessions.has(rootSessionId)) {
      return [];
    }

    const childSessionIdsByParent = new Map<string, string[]>();
    sessions.forEach(session => {
      const parentSessionId = session.parentSessionId;
      if (!parentSessionId) {
        return;
      }

      const existing = childSessionIdsByParent.get(parentSessionId) || [];
      existing.push(session.sessionId);
      childSessionIdsByParent.set(parentSessionId, existing);
    });

    const visited = new Set<string>();
    const orderedSessionIds: string[] = [];

    const visit = (sessionId: string): void => {
      if (visited.has(sessionId)) {
        return;
      }

      visited.add(sessionId);
      const childSessionIds = childSessionIdsByParent.get(sessionId) || [];
      childSessionIds.forEach(childSessionId => {
        visit(childSessionId);
      });
      orderedSessionIds.push(sessionId);
    };

    visit(rootSessionId);
    return orderedSessionIds;
  }

  public getCascadeSessionIds(sessionId: string): string[] {
    return this.collectCascadeSessionIds(sessionId, this.state.sessions);
  }

  public subscribeSelector<T>(
    selector: (state: FlowChatState) => T,
    listener: (selected: T, state: FlowChatState) => void,
    equality: (left: T, right: T) => boolean = objectIs,
  ): () => void {
    let selected = selector(this.state);
    const wrapped = (state: FlowChatState) => {
      const nextSelected = measureFlowChat('store.selector.compute', () => selector(state));
      if (equality(selected, nextSelected)) {
        return;
      }
      selected = nextSelected;
      listener(nextSelected, state);
    };

    incrementFlowChatCounter('store.subscribe.selector');
    this.listeners.add(wrapped);
    return () => {
      this.listeners.delete(wrapped);
    };
  }

  /**
   * Register a callback to persist unread completion changes.
   * Called by FlowChatManager during initialization.
   */
  public registerPersistUnreadCompletionCallback(
    callback: (sessionId: string, value: 'completed' | 'error' | 'interrupted' | undefined) => void
  ): void {
    this.onPersistUnreadCompletion = callback;
  }

  public createSession(
    sessionId: string,
    config: SessionConfig,
    _unused?: undefined,
    title?: string,
    maxContextTokens?: number,
    descriptor: SessionDescriptor = getDefaultSessionDescriptor(),
    workspacePath?: string,
    storageScope?: import('@/shared/types/session-history').SessionStorageScope
  ): void {
    import('../state-machine').then(({ stateMachineManager }) => {
      stateMachineManager.getOrCreate(sessionId);
    });
    
    this.setState(prev => {
      const relationship = normalizeSessionRelationship({ sessionKind: 'normal' });
      const session: Session = {
        sessionId,
        title: title || i18nService.t('flow-chat:session.new'),
        titleStatus: undefined,
        dialogTurns: [],
        status: 'idle',
        config: {
          ...config,
          agentType: getBackendAgentType(descriptor),
        },
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        lastFinishedAt: undefined,
        error: null,
        maxContextTokens: maxContextTokens || 128128,
        descriptor,
        workspacePath,
        workspaceId: config.workspaceId,
        storageScope: storageScope ?? config.storageScope ?? descriptor.storageScope,
        parentSessionId: relationship.parentSessionId,
        sessionKind: relationship.sessionKind,
        btwThreads: [],
        btwOrigin: relationship.btwOrigin,
        isTransient: false,
      };

      const newSessions = new Map(prev.sessions);
      newSessions.set(sessionId, session);

      return {
        ...prev,
        sessions: newSessions,
        activeSessionId: sessionId
      };
    });
  }

  /**
   * Add a session created externally without switching the active session.
   * workspacePath is stored on the session so the sidebar can filter by current workspace.
   */
  public addExternalSession(
    sessionId: string,
    title: string,
    descriptor: SessionDescriptor,
    workspacePath?: string,
    meta?: {
      parentSessionId?: string;
      sessionKind?: SessionKind;
      btwOrigin?: Session['btwOrigin'];
      isTransient?: boolean;
    },
    storageScope?: import('@/shared/types/session-history').SessionStorageScope
  ): void {
    import('../state-machine').then(({ stateMachineManager }) => {
      stateMachineManager.getOrCreate(sessionId);
    });

    this.setState(prev => {
      if (prev.sessions.has(sessionId)) {
        return prev;
      }

      const relationship = normalizeSessionRelationship(meta);
      const session: Session = {
        sessionId,
        title: title || i18nService.t('flow-chat:session.new'),
        titleStatus: 'generated',
        dialogTurns: [],
        status: 'idle',
        config: {
          maxContextTokens: 128128,
          autoCompact: true,
          enableTools: true,
          agentType: getBackendAgentType(descriptor),
        } as any,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        lastFinishedAt: undefined,
        error: null,
        maxContextTokens: 128128,
        descriptor,
        isHistorical: false,
        workspacePath,
        storageScope: storageScope ?? descriptor.storageScope,
        parentSessionId: relationship.parentSessionId,
        sessionKind: relationship.sessionKind,
        btwThreads: [],
        btwOrigin: relationship.btwOrigin,
        isTransient: meta?.isTransient ?? false,
      };

      const newSessions = new Map(prev.sessions);
      newSessions.set(sessionId, session);

      return {
        ...prev,
        sessions: newSessions,
      };
    });
  }

  public switchSession(sessionId: string): void {
    let descriptor: SessionDescriptor | undefined;
    this.setState(prev => {
      if (!prev.sessions.has(sessionId)) return prev;

      const session = prev.sessions.get(sessionId)!;
      descriptor = session.descriptor;

      const updatedSession = {
        ...session,
        lastActiveAt: Date.now()
      };

      const newSessions = new Map(prev.sessions);
      newSessions.set(sessionId, updatedSession);

      return {
        ...prev,
        sessions: newSessions,
        activeSessionId: sessionId
      };
    });
    
    window.dispatchEvent(new CustomEvent('sparo:session-switched', {
      detail: { sessionId, descriptor }
    }));
  }

  public reconcileSessionDescriptor(
    sessionId: string,
    descriptor: SessionDescriptor,
    workspacePath?: string,
    storageScope?: SessionStorageScope
  ): void {
    this.setState(prev => {
      const session = prev.sessions.get(sessionId);
      if (!session) return prev;

      const backendAgentType = getBackendAgentType(descriptor);
      const nextWorkspacePath = workspacePath || session.workspacePath;
      const nextStorageScope = storageScope ?? session.storageScope ?? descriptor.storageScope;

      if (
        session.descriptor.profileId === descriptor.profileId &&
        session.descriptor.agentPolicy.activeAgentId === descriptor.agentPolicy.activeAgentId &&
        session.config.agentType === backendAgentType &&
        session.workspacePath === nextWorkspacePath &&
        session.storageScope === nextStorageScope
      ) {
        return prev;
      }

      const updatedSession = {
        ...session,
        descriptor,
        config: {
          ...session.config,
          agentType: backendAgentType,
        },
        workspacePath: nextWorkspacePath,
        storageScope: nextStorageScope,
      };

      const newSessions = new Map(prev.sessions);
      newSessions.set(sessionId, updatedSession);

      return {
        ...prev,
        sessions: newSessions,
      };
    });
  }

  /**
   * Update the active inner agent for sessions that support agent switching.
   * @param sessionId Session ID
   * @param agentId Agent ID (e.g., 'agentic', 'Plan')
   */
  public updateSessionActiveAgent(sessionId: string, agentId: string): void {
    this.setState(prev => {
      const session = prev.sessions.get(sessionId);
      if (!session) return prev;

      const descriptor = withActiveAgentId(session.descriptor, agentId);
      const backendAgentType = getBackendAgentType(descriptor);
      if (
        session.descriptor.agentPolicy.activeAgentId === backendAgentType &&
        session.config.agentType === backendAgentType
      ) {
        return prev;
      }

      const updatedSession = {
        ...session,
        descriptor,
        config: {
          ...session.config,
          agentType: backendAgentType,
        },
        lastActiveAt: Date.now()
      };

      const newSessions = new Map(prev.sessions);
      newSessions.set(sessionId, updatedSession);

      return {
        ...prev,
        sessions: newSessions
      };
    });
  }

  public updateSessionModelName(sessionId: string, modelName: string): void {
    this.setState(prev => {
      const session = prev.sessions.get(sessionId);
      if (!session) return prev;

      const normalizedModelName = modelName.trim() || 'primary';
      if ((session.config.modelName || 'primary') === normalizedModelName) {
        return prev;
      }

      const updatedSession = {
        ...session,
        config: {
          ...session.config,
          modelName: normalizedModelName,
        },
        lastActiveAt: Date.now(),
      };

      const newSessions = new Map(prev.sessions);
      newSessions.set(sessionId, updatedSession);

      return {
        ...prev,
        sessions: newSessions,
      };
    });
  }

  /**
   * Update session relationship metadata (parent/child grouping, kind, etc.).
   * This is UI-only and does not affect backend behavior directly.
   */
  public updateSessionRelationship(
    sessionId: string,
    updates: { parentSessionId?: string; sessionKind?: SessionKind }
  ): void {
    this.setState(prev => {
      const session = prev.sessions.get(sessionId);
      if (!session) return prev;

      const relationship = normalizeSessionRelationship({
        sessionKind: updates.sessionKind ?? session.sessionKind,
        parentSessionId: updates.parentSessionId ?? session.parentSessionId,
        btwOrigin: session.btwOrigin,
      });
      const next: Session = {
        ...session,
        parentSessionId: relationship.parentSessionId,
        sessionKind: relationship.sessionKind,
        btwOrigin: relationship.btwOrigin,
      };

      const newSessions = new Map(prev.sessions);
      newSessions.set(sessionId, next);

      return { ...prev, sessions: newSessions };
    });
  }

  public updateSessionBtwOrigin(sessionId: string, origin: Session['btwOrigin']): void {
    this.setState(prev => {
      const session = prev.sessions.get(sessionId);
      if (!session) return prev;

      const relationship = normalizeSessionRelationship({
        sessionKind: 'btw',
        parentSessionId: origin?.parentSessionId ?? session.parentSessionId,
        btwOrigin: { ...(session.btwOrigin || {}), ...(origin || {}) },
      });
      const next: Session = {
        ...session,
        parentSessionId: relationship.parentSessionId,
        sessionKind: relationship.sessionKind,
        btwOrigin: relationship.btwOrigin,
      };

      const newSessions = new Map(prev.sessions);
      newSessions.set(sessionId, next);
      return { ...prev, sessions: newSessions };
    });
  }

  public addBtwThreadMarker(
    parentSessionId: string,
    marker: {
      requestId: string;
      childSessionId: string;
      title: string;
      status: 'running' | 'done' | 'error';
      createdAt: number;
      parentDialogTurnId?: string;
      parentTurnIndex?: number;
      error?: string;
    }
  ): void {
    this.setState(prev => {
      const session = prev.sessions.get(parentSessionId);
      if (!session) return prev;

      const existing = session.btwThreads || [];
      if (existing.some(t => t.requestId === marker.requestId)) {
        return prev;
      }

      const nextSession: Session = {
        ...session,
        btwThreads: [marker, ...existing].slice(0, 20),
        lastActiveAt: Date.now(),
      };

      const newSessions = new Map(prev.sessions);
      newSessions.set(parentSessionId, nextSession);
      return { ...prev, sessions: newSessions };
    });
  }

  public updateBtwThreadMarker(
    parentSessionId: string,
    requestId: string,
    updates: Partial<{
      status: 'running' | 'done' | 'error';
      error?: string;
      title: string;
    }>
  ): void {
    this.setState(prev => {
      const session = prev.sessions.get(parentSessionId);
      if (!session) return prev;

      const existing = session.btwThreads || [];
      if (existing.length === 0) return prev;

      const nextThreads = existing.map(t => {
        if (t.requestId !== requestId) return t;
        return { ...t, ...updates };
      });

      const newSessions = new Map(prev.sessions);
      newSessions.set(parentSessionId, { ...session, btwThreads: nextThreads });
      return { ...prev, sessions: newSessions };
    });
  }

  public removeBtwThreadMarker(parentSessionId: string, requestId: string): void {
    this.setState(prev => {
      const session = prev.sessions.get(parentSessionId);
      if (!session) return prev;
      const existing = session.btwThreads || [];
      const nextThreads = existing.filter(t => t.requestId !== requestId);
      const newSessions = new Map(prev.sessions);
      newSessions.set(parentSessionId, { ...session, btwThreads: nextThreads });
      return { ...prev, sessions: newSessions };
    });
  }

  /**
   * Move session to front by updating createdAt timestamp
   */
  public moveSessionToFront(sessionId: string): void {
    this.setState(prev => {
      const session = prev.sessions.get(sessionId);
      if (!session) return prev;

      const updatedSession = {
        ...session,
        createdAt: Date.now(),
        lastActiveAt: Date.now()
      };

      const newSessions = new Map(prev.sessions);
      newSessions.set(sessionId, updatedSession);

      return {
        ...prev,
        sessions: newSessions
      };
    });
  }

  public async deleteSession(sessionId: string): Promise<void> {
    const sessionIdsToDelete = this.getCascadeSessionIds(sessionId);
    if (sessionIdsToDelete.length === 0) {
      return;
    }

    const { agentAPI } = await import('@/infrastructure/api');
    await Promise.all(
      sessionIdsToDelete.map(async id => {
        const sess = this.state.sessions.get(id);
        if (!sess) {
          throw new Error(`Session not found: ${id}`);
        }
        const storageScope = resolveSessionDeleteStorageScope(sess);
        const workspacePath = sess.workspacePath;
        if (!workspacePath && storageScope !== 'agentic_os') {
          throw new Error(`Workspace path not found for session ${id}`);
        }

        await agentAPI.deleteSession(id, workspacePath || undefined, storageScope);
      })
    );

    const { stateMachineManager } = await import('../state-machine');
    sessionIdsToDelete.forEach(id => {
      stateMachineManager.delete(id);
    });

    this.removeSession(sessionId);
  }

  public removeSession(sessionId: string): string[] {
    const removedSessionIds = this.getCascadeSessionIds(sessionId);
    if (removedSessionIds.length === 0) {
      return [];
    }

    this.setState(prev => {
      const removedSessionIdSet = new Set(removedSessionIds);
      const newSessions = new Map(prev.sessions);
      const removedSessions = removedSessionIds
        .map(id => prev.sessions.get(id))
        .filter((session): session is Session => Boolean(session));

      removedSessionIds.forEach(id => {
        newSessions.delete(id);
      });

      removedSessions.forEach(session => {
        const parentSessionId = session.btwOrigin?.parentSessionId ?? session.parentSessionId;
        if (!parentSessionId || removedSessionIdSet.has(parentSessionId)) {
          return;
        }

        const parentSession = newSessions.get(parentSessionId);
        if (!parentSession?.btwThreads?.length) {
          return;
        }

        const requestId = session.btwOrigin?.requestId;
        const nextThreads = parentSession.btwThreads.filter(thread => {
          if (thread.childSessionId === session.sessionId) {
            return false;
          }

          if (requestId && thread.requestId === requestId) {
            return false;
          }

          return true;
        });

        if (nextThreads.length !== parentSession.btwThreads.length) {
          newSessions.set(parentSessionId, {
            ...parentSession,
            btwThreads: nextThreads,
          });
        }
      });

      let newActiveSessionId = prev.activeSessionId;
      if (prev.activeSessionId && removedSessionIdSet.has(prev.activeSessionId)) {
        const remainingSessions = Array.from(newSessions.keys());
        newActiveSessionId = remainingSessions.length > 0 ? remainingSessions[0] : null;
      }

      return {
        ...prev,
        sessions: newSessions,
        activeSessionId: newActiveSessionId
      };
    });

    return removedSessionIds;
  }

  public clearSession(sessionId?: string): void {
    const targetSessionId = sessionId || this.state.activeSessionId;
    if (!targetSessionId) return;

    this.setState(prev => {
      const session = prev.sessions.get(targetSessionId);
      if (!session) return prev;

      const clearedSession = {
        ...session,
        dialogTurns: [],
        error: null,
        lastActiveAt: Date.now()
      };

      const newSessions = new Map(prev.sessions);
      newSessions.set(targetSessionId, clearedSession);

      return {
        ...prev,
        sessions: newSessions
      };
    });
  }

  /**
   * Remove sessions bound to a workspace using stable id + host/path scope (never path-only).
   */
  public removeSessionsForWorkspace(
    workspace: Pick<WorkspaceInfo, 'id' | 'rootPath'>
  ): string[] {
    const removedSessionIds = Array.from(this.state.sessions.values())
      .filter(session => sessionMatchesWorkspace(session, workspace))
      .map(session => session.sessionId);

    return this.removeSessionsByIds(removedSessionIds);
  }

  /** @deprecated Prefer `removeSessionsForWorkspace` with full `WorkspaceInfo`. */
  public removeSessionsByWorkspace(workspacePath: string): string[] {
    const removedSessionIds = Array.from(this.state.sessions.values())
      .filter(session => sessionBelongsToWorkspaceNavRow(session, workspacePath))
      .map(session => session.sessionId);

    return this.removeSessionsByIds(removedSessionIds);
  }

  private removeSessionsByIds(removedSessionIds: string[]): string[] {

    if (removedSessionIds.length === 0) {
      return [];
    }

    const removedSessionIdSet = new Set(removedSessionIds);
    removedSessionIds.forEach(sessionId => {
      this.warmedSessionIds.delete(sessionId);
      this.clearSessionToolIndex(sessionId);
    });

    this.setState(prev => {
      const newSessions = new Map(prev.sessions);
      removedSessionIdSet.forEach(sessionId => {
        newSessions.delete(sessionId);
      });

      return {
        ...prev,
        sessions: newSessions,
        activeSessionId:
          prev.activeSessionId && removedSessionIdSet.has(prev.activeSessionId)
            ? null
            : prev.activeSessionId
      };
    });

    return removedSessionIds;
  }

  public getActiveSession(): Session | null {
    if (!this.state.activeSessionId) {
      return null;
    }
    return this.state.sessions.get(this.state.activeSessionId) || null;
  }

  private indexToolItem(sessionId: string, dialogTurnId: string, item: FlowItem): void {
    if (item.type !== 'tool') {
      return;
    }

    this.toolItemIndex.set(item.id, {
      sessionId,
      dialogTurnId,
      itemId: item.id,
    });
  }

  private clearSessionToolIndex(sessionId: string): void {
    for (const [toolUseId, location] of this.toolItemIndex) {
      if (location.sessionId === sessionId) {
        this.toolItemIndex.delete(toolUseId);
      }
    }
  }

  private clearDialogTurnToolIndex(sessionId: string, dialogTurnId: string): void {
    for (const [toolUseId, location] of this.toolItemIndex) {
      if (location.sessionId === sessionId && location.dialogTurnId === dialogTurnId) {
        this.toolItemIndex.delete(toolUseId);
      }
    }
  }

  private syncToolIndexForStateChange(previousState: FlowChatState, nextState: FlowChatState): void {
    if (previousState.sessions === nextState.sessions) {
      return;
    }

    for (const [sessionId, previousSession] of previousState.sessions) {
      const nextSession = nextState.sessions.get(sessionId);
      if (!nextSession) {
        this.clearSessionToolIndex(sessionId);
      } else if (nextSession !== previousSession) {
        this.clearSessionToolIndex(sessionId);
        for (const dialogTurn of nextSession.dialogTurns) {
          this.indexDialogTurnTools(sessionId, dialogTurn);
        }
      }
    }

    for (const [sessionId, nextSession] of nextState.sessions) {
      if (previousState.sessions.has(sessionId)) {
        continue;
      }
      for (const dialogTurn of nextSession.dialogTurns) {
        this.indexDialogTurnTools(sessionId, dialogTurn);
      }
    }
  }

  private indexDialogTurnTools(sessionId: string, dialogTurn: DialogTurn): void {
    this.clearDialogTurnToolIndex(sessionId, dialogTurn.id);
    for (const modelRound of dialogTurn.modelRounds) {
      for (const item of modelRound.items) {
        this.indexToolItem(sessionId, dialogTurn.id, item);
      }
    }
  }

  private dialogTurnHasTool(dialogTurn: DialogTurn): boolean {
    return dialogTurn.modelRounds.some(modelRound =>
      modelRound.items.some(item => item.type === 'tool')
    );
  }

  public addDialogTurn(sessionId: string, dialogTurn: DialogTurn): void {
    this.setState(prev => {
      const session = prev.sessions.get(sessionId);
      if (!session) return prev;

      if (session.dialogTurns.some(turn => turn.id === dialogTurn.id)) {
        return prev;
      }

      const updatedSession = {
        ...session,
        dialogTurns: [...session.dialogTurns, dialogTurn],
        lastActiveAt: Date.now()
      };

      for (const modelRound of dialogTurn.modelRounds) {
        for (const item of modelRound.items) {
          this.indexToolItem(sessionId, dialogTurn.id, item);
        }
      }

      const newSessions = new Map(prev.sessions);
      newSessions.set(sessionId, updatedSession);

      return {
        ...prev,
        sessions: newSessions
      };
    });
  }

  public deleteDialogTurn(sessionId: string, dialogTurnId: string): void {
    this.setState(prev => {
      const session = prev.sessions.get(sessionId);
      if (!session) return prev;

      const updatedDialogTurns = session.dialogTurns.filter(turn => turn.id !== dialogTurnId);

      const updatedSession = {
        ...session,
        dialogTurns: updatedDialogTurns,
        lastActiveAt: Date.now()
      };

      this.clearDialogTurnToolIndex(sessionId, dialogTurnId);

      const newSessions = new Map(prev.sessions);
      newSessions.set(sessionId, updatedSession);

      return {
        ...prev,
        sessions: newSessions
      };
    });
  }

  /**
   * Delete all dialog turns from turnIndex (inclusive)
   * Used for turn rollback: revert to before this turn and remove this turn and all subsequent history
   */
  public truncateDialogTurnsFrom(sessionId: string, turnIndex: number): void {

    this.setState(prev => {
      const session = prev.sessions.get(sessionId);
      if (!session) return prev;

      const clampedIndex = Math.max(0, Math.min(turnIndex, session.dialogTurns.length));
      const updatedSession = {
        ...session,
        dialogTurns: session.dialogTurns.slice(0, clampedIndex),
        lastActiveAt: Date.now()
      };

      for (const removedTurn of session.dialogTurns.slice(clampedIndex)) {
        this.clearDialogTurnToolIndex(sessionId, removedTurn.id);
      }

      const newSessions = new Map(prev.sessions);
      newSessions.set(sessionId, updatedSession);

      return {
        ...prev,
        sessions: newSessions
      };
    });
  }

  public updateDialogTurn(sessionId: string, dialogTurnId: string, updater: (turn: DialogTurn) => DialogTurn): void {
    this.setState(prev => {
      const session = prev.sessions.get(sessionId);
      if (!session) return prev;

      let previousTurn: DialogTurn | undefined;
      let nextTurn: DialogTurn | undefined;
      const updatedDialogTurns = session.dialogTurns.map(turn => {
        if (turn.id !== dialogTurnId) {
          return turn;
        }
        previousTurn = turn;
        nextTurn = updater(turn);
        return nextTurn;
      });

      const updatedSession = {
        ...session,
        dialogTurns: updatedDialogTurns,
        lastActiveAt: Date.now()
      };

      if (nextTurn && (this.dialogTurnHasTool(nextTurn) || (previousTurn && this.dialogTurnHasTool(previousTurn)))) {
        this.indexDialogTurnTools(sessionId, nextTurn);
      }

      const newSessions = new Map(prev.sessions);
      newSessions.set(sessionId, updatedSession);

      return {
        ...prev,
        sessions: newSessions
      };
    });
  }

  public addFollowUpUserMessage(
    sessionId: string,
    dialogTurnId: string,
    message: NonNullable<DialogTurn['followUpUserMessages']>[number]
  ): void {
    this.updateDialogTurn(sessionId, dialogTurnId, turn => {
      const existing = turn.followUpUserMessages ?? [];
      if (existing.some(item => item.id === message.id)) {
        return turn;
      }

      return {
        ...turn,
        followUpUserMessages: [...existing, message],
      };
    });
  }

  public updateFollowUpUserMessage(
    sessionId: string,
    dialogTurnId: string,
    messageId: string,
    updates: Partial<NonNullable<DialogTurn['followUpUserMessages']>[number]>
  ): void {
    this.updateDialogTurn(sessionId, dialogTurnId, turn => {
      const existing = turn.followUpUserMessages ?? [];
      if (!existing.some(item => item.id === messageId)) {
        return turn;
      }

      return {
        ...turn,
        followUpUserMessages: existing.map(item =>
          item.id === messageId ? { ...item, ...updates } : item
        ),
      };
    });
  }

  /**
   * Add image analysis phase to dialog turn
   */
  public addImageAnalysisPhase(
    sessionId: string, 
    dialogTurnId: string, 
    imageContexts: import('@/shared/types/context').ImageContext[]
  ): void {
    this.updateDialogTurn(sessionId, dialogTurnId, turn => {
      const imageAnalysisItems: FlowImageAnalysisItem[] = imageContexts.map((ctx, index) => ({
        id: `img-analysis-${ctx.id}`,
        type: 'image-analysis',
        imageContext: ctx,
        result: null,
        status: 'analyzing',
        timestamp: Date.now() + index,
      }));

      return {
        ...turn,
        imageAnalysisPhase: {
          items: imageAnalysisItems,
          status: 'analyzing',
          startTime: Date.now(),
        },
        status: 'image_analyzing',
      };
    });
  }

  /**
   * Update image analysis results
   */
  public updateImageAnalysisResults(
    sessionId: string,
    dialogTurnId: string,
    results: ImageAnalysisResult[]
  ): void {
      this.updateDialogTurn(sessionId, dialogTurnId, turn => {
        if (!turn.imageAnalysisPhase) {
          log.warn('Attempting to update non-existent image analysis phase', { sessionId, dialogTurnId });
          return turn;
        }

      const updatedItems: FlowImageAnalysisItem[] = turn.imageAnalysisPhase.items.map(item => {
        const result = results.find(r => r.image_id === item.imageContext.id);
        if (result) {
          return {
            ...item,
            result,
            status: 'completed' as const,
          };
        }
        return item;
      });

      const allCompleted = updatedItems.every(item => item.status === 'completed');

      return {
        ...turn,
        imageAnalysisPhase: {
          ...turn.imageAnalysisPhase,
          items: updatedItems,
          status: allCompleted ? 'completed' : 'analyzing',
          endTime: allCompleted ? Date.now() : undefined,
        },
        status: allCompleted ? 'pending' : 'image_analyzing',
      };
    });
  }

  /**
   * Update single image analysis item status (for error handling)
   */
  public updateImageAnalysisItem(
    sessionId: string,
    dialogTurnId: string,
    imageId: string,
    updates: { status?: 'analyzing' | 'completed' | 'error'; error?: string; result?: any }
  ): void {
    this.updateDialogTurn(sessionId, dialogTurnId, turn => {
      if (!turn.imageAnalysisPhase) return turn;

      const updatedItems = turn.imageAnalysisPhase.items.map(item => {
        if (item.imageContext.id === imageId) {
          return { ...item, ...updates };
        }
        return item;
      });

      return {
        ...turn,
        imageAnalysisPhase: {
          ...turn.imageAnalysisPhase,
          items: updatedItems,
        },
      };
    });
  }

  public addModelRound(sessionId: string, dialogTurnId: string, modelRound: ModelRound): void {
    this.updateDialogTurn(sessionId, dialogTurnId, turn => ({
      ...turn,
      modelRounds: [...turn.modelRounds, modelRound],
      status: 'processing'
    }));
  }

  public updateModelRound(sessionId: string, dialogTurnId: string, modelRoundId: string, updater: (round: ModelRound) => ModelRound): void {
    this.updateDialogTurn(sessionId, dialogTurnId, turn => ({
      ...turn,
      modelRounds: turn.modelRounds.map(round => 
        round.id === modelRoundId ? updater(round) : round
      )
    }));
  }

  /**
   * Batch update multiple model round items (reduces store update frequency)
   */
  public batchUpdateModelRoundItems(
    sessionId: string, 
    dialogTurnId: string, 
    updates: Array<{ itemId: string; changes: Partial<FlowItem> }>
  ): void {
    if (updates.length === 0) return;
    
    this.updateDialogTurn(sessionId, dialogTurnId, turn => {
      const updatesById = new Map(updates.map(update => [update.itemId, update.changes]));
      const updatedModelRounds = turn.modelRounds.map(round => ({
        ...round,
        items: round.items.map(item => {
          const update = updatesById.get(item.id);
          return update ? ({ ...item, ...update } as AnyFlowItem) : item;
        })
      }));
      
      return {
        ...turn,
        modelRounds: updatedModelRounds
      };
    });
  }

  public addModelRoundItem(sessionId: string, dialogTurnId: string, item: AnyFlowItem, modelRoundId?: string): void {
    this.updateDialogTurn(sessionId, dialogTurnId, turn => {
      let targetModelRoundIndex = turn.modelRounds.length - 1;
        if (modelRoundId) {
          targetModelRoundIndex = turn.modelRounds.findIndex(round => round.id === modelRoundId);
          if (targetModelRoundIndex === -1) {
            log.warn('Model round not found', { sessionId, dialogTurnId, modelRoundId });
            return turn;
          }
        }
        
        if (targetModelRoundIndex === -1) {
          log.warn('No available model rounds', { sessionId, dialogTurnId });
          return turn;
        }

      const targetModelRound = turn.modelRounds[targetModelRoundIndex];

      const existingItem = targetModelRound.items.find(existingItem => existingItem.id === item.id);
      if (existingItem) {
        return turn;
      }

      const updatedModelRounds = [...turn.modelRounds];
      
      updatedModelRounds[targetModelRoundIndex] = {
        ...targetModelRound,
        items: [...targetModelRound.items, item]
      };

      return {
        ...turn,
        modelRounds: updatedModelRounds
      };
    });
  }

  /**
   * Silent add ModelRound item (does not trigger listeners)
   * Used for batch update scenarios
   */
  public addModelRoundItemSilent(sessionId: string, dialogTurnId: string, item: AnyFlowItem, modelRoundId?: string): void {
    const prevSilentMode = this.silentMode;
    this.silentMode = true;
    try {
      this.addModelRoundItem(sessionId, dialogTurnId, item, modelRoundId);
    } finally {
      this.silentMode = prevSilentMode;
    }
  }

  public updateModelRoundItem(sessionId: string, dialogTurnId: string, itemId: string, updates: Partial<FlowItem>): void {
    this.updateDialogTurn(sessionId, dialogTurnId, turn => {
      for (let roundIndex = 0; roundIndex < turn.modelRounds.length; roundIndex += 1) {
        const modelRound = turn.modelRounds[roundIndex];
        const itemIndex = modelRound.items.findIndex((item: any) => item.id === itemId);
        if (itemIndex === -1) {
          continue;
        }

        const updatedItems = [...modelRound.items];
        updatedItems[itemIndex] = { ...updatedItems[itemIndex], ...updates } as AnyFlowItem;

        const updatedModelRounds = [...turn.modelRounds];
        updatedModelRounds[roundIndex] = {
          ...modelRound,
          items: updatedItems
        };

        return {
          ...turn,
          modelRounds: updatedModelRounds
        };
      }

      log.warn('Item not found for update', { sessionId, dialogTurnId, itemId });
      return turn;
    });
  }

  /**
   * Silent update ModelRound item (does not trigger listeners)
   * Used for batch update scenarios
   */
  public updateModelRoundItemSilent(sessionId: string, dialogTurnId: string, itemId: string, updates: Partial<FlowItem>): void {
    const prevSilentMode = this.silentMode;
    this.silentMode = true;
    try {
      this.updateModelRoundItem(sessionId, dialogTurnId, itemId, updates);
    } finally {
      this.silentMode = prevSilentMode;
    }
  }

  /**
   * Find tool item (for early detection updates)
   */
  public findToolItem(sessionId: string, dialogTurnId: string, toolUseId: string): FlowItem | null {
    const session = this.state.sessions.get(sessionId);
    if (!session) return null;

    const dialogTurn = session.dialogTurns.find(turn => turn.id === dialogTurnId);
    if (!dialogTurn) return null;

    for (const modelRound of dialogTurn.modelRounds) {
      const item = modelRound.items.find((item: any) => item.id === toolUseId);
      if (item) {
        this.indexToolItem(sessionId, dialogTurnId, item);
        return item;
      }
    }

    return null;
  }

  public findToolItemLocation(toolUseId: string): ToolItemLocation | null {
    const indexed = this.toolItemIndex.get(toolUseId);
    if (indexed) {
      const item = this.findToolItem(indexed.sessionId, indexed.dialogTurnId, toolUseId);
      if (item) {
        return { ...indexed, item };
      }
      this.toolItemIndex.delete(toolUseId);
    }

    return null;
  }

  public updateTokenUsage(
    sessionId: string, 
    tokenUsage: { inputTokens: number; outputTokens?: number; totalTokens: number }
  ): void {
    this.setState(prev => {
      const session = prev.sessions.get(sessionId);
      if (!session) return prev;

      const updatedSession = {
        ...session,
        currentTokenUsage: {
          inputTokens: tokenUsage.inputTokens,
          outputTokens: tokenUsage.outputTokens,
          totalTokens: tokenUsage.totalTokens,
          timestamp: Date.now()
        }
      };

      const newSessions = new Map(prev.sessions);
      newSessions.set(sessionId, updatedSession);

      return {
        ...prev,
        sessions: newSessions
      };
    });
  }

  public updateContextBudget(sessionId: string, snapshot: import('../types/flow-chat').ContextBudgetSnapshot): void {
    this.setState(prev => {
      const session = prev.sessions.get(sessionId);
      if (!session) return prev;

      const updatedSession = {
        ...session,
        currentContextBudget: snapshot,
        maxContextTokens: snapshot.contextWindow || session.maxContextTokens
      };

      const newSessions = new Map(prev.sessions);
      newSessions.set(sessionId, updatedSession);

      return {
        ...prev,
        sessions: newSessions
      };
    });
  }

  public rollbackTokenUsage(): void {
  }

  public updateSessionMaxContextTokens(sessionId: string, maxContextTokens: number): void {
    this.setState(prev => {
      const session = prev.sessions.get(sessionId);
      if (!session) return prev;

      if (session.maxContextTokens === maxContextTokens) return prev;

      const updatedSession = {
        ...session,
        maxContextTokens
      };

      const newSessions = new Map(prev.sessions);
      newSessions.set(sessionId, updatedSession);

      return {
        ...prev,
        sessions: newSessions
      };
    });
  }

  public setError(sessionId: string, error: string | null): void {
    this.setState(prev => {
      const session = prev.sessions.get(sessionId);
      if (!session) return prev;

      const updatedSession: Session = {
        ...session,
        error,
        status: error ? 'error' as const : 'idle' as const,
        lastActiveAt: Date.now()
      };

      const newSessions = new Map(prev.sessions);
      newSessions.set(sessionId, updatedSession);

      return {
        ...prev,
        sessions: newSessions
      };
    });
  }

  public markSessionFinished(sessionId: string, timestamp: number = Date.now()): void {
    this.setState(prev => {
      const session = prev.sessions.get(sessionId);
      if (!session) return prev;

      const updatedSession: Session = {
        ...session,
        lastActiveAt: timestamp,
        lastFinishedAt: timestamp,
      };

      const newSessions = new Map(prev.sessions);
      newSessions.set(sessionId, updatedSession);

      return {
        ...prev,
        sessions: newSessions,
      };
    });
  }

  public markSessionUnreadCompletion(
    sessionId: string,
    completionKind: 'completed' | 'error' | 'interrupted'
  ): void {
    this.setState(prev => {
      const session = prev.sessions.get(sessionId);
      if (!session) return prev;

      const updatedSession: Session = {
        ...session,
        hasUnreadCompletion: completionKind,
      };

      const newSessions = new Map(prev.sessions);
      newSessions.set(sessionId, updatedSession);

      return { ...prev, sessions: newSessions };
    });
    this.onPersistUnreadCompletion?.(sessionId, completionKind);
  }

  public clearSessionUnreadCompletion(sessionId: string): void {
    let didClear = false;
    this.setState(prev => {
      const session = prev.sessions.get(sessionId);
      if (!session || !session.hasUnreadCompletion) return prev;

      const updatedSession: Session = {
        ...session,
        hasUnreadCompletion: undefined,
      };

      const newSessions = new Map(prev.sessions);
      newSessions.set(sessionId, updatedSession);

      didClear = true;
      return { ...prev, sessions: newSessions };
    });
    if (didClear) {
      this.onPersistUnreadCompletion?.(sessionId, undefined);
    }
  }

  public setSessionNeedsAttention(
    sessionId: string,
    attentionKind: 'ask_user' | 'tool_confirm'
  ): void {
    this.setState(prev => {
      const session = prev.sessions.get(sessionId);
      if (!session) return prev;

      const updatedSession: Session = {
        ...session,
        needsUserAttention: attentionKind,
      };

      const newSessions = new Map(prev.sessions);
      newSessions.set(sessionId, updatedSession);

      return { ...prev, sessions: newSessions };
    });
    this.onPersistUnreadCompletion?.(sessionId, undefined);
  }

  public clearSessionNeedsAttention(sessionId: string): void {
    let didClear = false;
    this.setState(prev => {
      const session = prev.sessions.get(sessionId);
      if (!session || !session.needsUserAttention) return prev;

      const updatedSession: Session = {
        ...session,
        needsUserAttention: undefined,
      };

      const newSessions = new Map(prev.sessions);
      newSessions.set(sessionId, updatedSession);

      didClear = true;
      return { ...prev, sessions: newSessions };
    });
    if (didClear) {
      this.onPersistUnreadCompletion?.(sessionId, undefined);
    }
  }

  public async updateSessionTitle(
    sessionId: string, 
    title: string, 
    status: 'generating' | 'generated' | 'failed'
  ): Promise<void> {
    this.setState(prev => {
      const session = prev.sessions.get(sessionId);
      if (!session) return prev;

      const updatedSession = {
        ...session,
        title,
        titleStatus: status,
        lastActiveAt: Date.now()
      };

      const newSessions = new Map(prev.sessions);
      newSessions.set(sessionId, updatedSession);

      return {
        ...prev,
        sessions: newSessions
      };
    });
  }

  /**
   * Cancel current session task (UI state update)
   * Called by SessionStateMachine side effects, updates all related states to cancelled
   */
  public cancelSessionTask(sessionId: string): void {
    this.setState(prev => {
      const session = prev.sessions.get(sessionId);
      if (!session) {
        log.warn('Session not found', { sessionId });
        return prev;
      }

      const lastDialogTurn = session.dialogTurns[session.dialogTurns.length - 1];
      if (!lastDialogTurn) {
        log.warn('No dialog turns found', { sessionId });
        return prev;
      }

      if (lastDialogTurn.status === 'completed' || lastDialogTurn.status === 'cancelled') {
        return prev;
      }

      const settledAt = Date.now();
      const updatedDialogTurns = session.dialogTurns.map((turn, index) =>
        index === session.dialogTurns.length - 1
          ? finalizeFlowTurn(turn, { settledAt, reason: 'user_cancelled' })
          : turn
      );

      const updatedSession = {
        ...session,
        dialogTurns: updatedDialogTurns,
        status: 'idle' as const,
        lastActiveAt: Date.now()
      };

      const newSessions = new Map(prev.sessions);
      newSessions.set(sessionId, updatedSession);

      window.dispatchEvent(new CustomEvent('sparo:dialog-cancelled', {
        detail: { sessionId }
      }));

      const lastTurn = updatedDialogTurns[updatedDialogTurns.length - 1];
      if (lastTurn && lastTurn.status === 'cancelled') {
        this.saveCancelledDialogTurn(sessionId, lastTurn.id).catch(error => {
          log.error('Failed to save cancelled dialog turn', { sessionId, turnId: lastTurn.id, error });
        });
      }

      return {
        ...prev,
        sessions: newSessions
      };
    });
  }

  /**
   * Save cancelled dialog turn to disk
   */
  private async saveCancelledDialogTurn(sessionId: string, turnId: string): Promise<void> {
    try {
      const { sessionAPI } = await import('@/infrastructure/api');
      const session = this.state.sessions.get(sessionId);
      if (!session) {
        log.warn('Session not found, skipping save', { sessionId, turnId });
        return;
      }
      if (session.isTransient) {
        return;
      }

      const workspacePath = session.workspacePath;
      if (!workspacePath) {
        log.warn('Workspace path not available, skipping save', { sessionId, turnId });
        return;
      }

      const dialogTurn = session.dialogTurns.find(turn => turn.id === turnId);
      if (!dialogTurn) {
        log.warn('Dialog turn not found, skipping save', { sessionId, turnId });
        return;
      }

      const turnIndex = session.dialogTurns.findIndex(t => t.id === turnId);
      
      const turnData = {
        turnId,
        turnIndex,
        sessionId,
        timestamp: dialogTurn.startTime,
        kind: dialogTurn.kind || 'user_dialog',
        userMessage: {
          id: dialogTurn.userMessage.id,
          content: dialogTurn.userMessage.content,
          timestamp: dialogTurn.userMessage.timestamp,
          metadata: dialogTurn.userMessage.metadata,
        },
        followUpUserMessages: dialogTurn.followUpUserMessages?.map(message => ({
          id: message.id,
          content: message.content,
          timestamp: message.timestamp,
          kind: message.kind,
          status: message.status,
          guidanceId: message.guidanceId,
          sourceTurnId: message.sourceTurnId,
          appliedAt: message.appliedAt,
          error: message.error,
          hasImages: message.hasImages,
          imageCount: message.imageCount,
          metadata: message.metadata,
        })),
        modelRounds: dialogTurn.modelRounds.map((round, roundIndex) => {
          const textItems = round.items
            .filter(item => item.type === 'text')
            .map(item => ({
              id: item.id,
              content: (item as any).content || '',
              isStreaming: false,
              timestamp: item.timestamp,
              status: item.status,
            }));
          
          const toolItems = round.items
            .filter(item => item.type === 'tool')
            .map(item => ({
              id: item.id,
              toolName: (item as any).toolName || '',
              interruptionReason: (item as any).interruptionReason,
              toolCall: (item as any).toolCall || { input: {}, id: item.id },
              toolResult: (item as any).toolResult,
              aiIntent: (item as any).aiIntent,
              startTime: (item as any).startTime || item.timestamp,
              endTime: (item as any).endTime,
              status: item.status,
              executionProjection: (item as any).executionProjection,
              durationMs: (item as any).endTime 
                ? (item as any).endTime - (item as any).startTime 
                : undefined
            }));
          
          const thinkingItems = round.items
            .filter(item => item.type === 'thinking')
            .map(item => ({
              id: item.id,
              content: (item as any).content || '',
              isStreaming: false,
              isCollapsed: (item as any).isCollapsed || false,
              timestamp: item.timestamp,
              status: item.status,
            }));
          
          return {
            id: round.id,
            turnId,
            roundIndex,
            timestamp: round.startTime,
            textItems,
            toolItems,
            thinkingItems,
            startTime: round.startTime,
            endTime: round.endTime || Date.now(),
            status: round.status
          };
        }),
        startTime: dialogTurn.startTime,
        endTime: dialogTurn.endTime || Date.now(),
        durationMs: (dialogTurn.endTime || Date.now()) - dialogTurn.startTime,
        status: 'cancelled' as const
      };

      await sessionAPI.saveSessionTurn(
        turnData,
        workspacePath,
        session.storageScope
      );
    } catch (error) {
      log.error('Failed to save cancelled dialog turn', { sessionId, turnId, error });
    }
  }


  /**
   * Initialize by loading persisted session metadata from disk
   * Clears sessions from other workspaces, then loads sessions for the target workspace.
   */
  public async hydrateWorkspaceSessionsMetadata(
    metadataList: SessionMetadata[],
    workspacePath: string,
    storageScope?: import('@/shared/types/session-history').SessionStorageScope
  ): Promise<number> {
    const { stateMachineManager } = await import('../state-machine');
    metadataList.forEach(metadata => {
      stateMachineManager.getOrCreate(metadata.sessionId);
    });

    let insertedCount = 0;
    const processSession = async (metadata: SessionMetadata) => {
      const existingSession = this.state.sessions.get(metadata.sessionId);
      const relationship = deriveSessionRelationshipFromMetadata(metadata);
      const lastFinishedAt = deriveLastFinishedAtFromMetadata(metadata);

      if (existingSession) {
        const incomingUpdatedAt = metadata.lastActiveAt ?? metadata.createdAt ?? 0;
        const existingUpdatedAt =
          existingSession.updatedAt ??
          existingSession.lastActiveAt ??
          existingSession.lastFinishedAt ??
          existingSession.createdAt;
        if (incomingUpdatedAt <= existingUpdatedAt) {
          return;
        }

        this.setState(prev => {
          const currentSession = prev.sessions.get(metadata.sessionId);
          if (!currentSession) return prev;
          const descriptor = descriptorFromAgentType(metadata.agentType || getBackendAgentType(currentSession.descriptor));

          const nextSessions = new Map(prev.sessions);
          nextSessions.set(metadata.sessionId, {
            ...currentSession,
            descriptor,
            config: {
              ...currentSession.config,
              agentType: getBackendAgentType(descriptor),
            },
            title: metadata.sessionName,
            lastActiveAt: metadata.lastActiveAt,
            lastFinishedAt,
            updatedAt: incomingUpdatedAt,
            todos: metadata.todos || currentSession.todos || [],
            workspacePath: metadata.workspacePath || currentSession.workspacePath || workspacePath,
            storageScope: metadata.storageScope || currentSession.storageScope || storageScope || descriptor.storageScope,
            parentSessionId: relationship.parentSessionId,
            sessionKind: relationship.sessionKind,
            btwOrigin: relationship.btwOrigin,
            hasUnreadCompletion: metadata.unreadCompletion,
            needsUserAttention: metadata.needsUserAttention,
            isTransient: false,
            isHistorical: currentSession.dialogTurns.length === 0 ? true : currentSession.isHistorical,
          });
          return {
            ...prev,
            sessions: nextSessions,
          };
        });
        return;
      }
      if (isLegacyPersistedBtwSession(metadata)) {
        return;
      }

      let maxContextTokens = 128128;
      try {
        const { configManager } = await import('@/infrastructure/config/services/ConfigManager');
        const models = await configManager.getConfig<any[]>('ai.models') || [];

        if (metadata.modelName) {
          const model = models.find((m: any) => m.name === metadata.modelName || m.id === metadata.modelName);
          if (model?.context_window) {
            maxContextTokens = model.context_window;
          }
        }

        if (maxContextTokens === 128128) {
          const defaultModels = await configManager.getConfig<Record<string, string>>('ai.default_models');
          const primaryModelId = defaultModels?.primary;

          if (primaryModelId) {
            const primaryModel = models.find((m: any) => m.id === primaryModelId);
            if (primaryModel?.context_window) {
              maxContextTokens = primaryModel.context_window;
            }
          }
        }
      } catch (error) {
        log.warn('Failed to get model context window size, using default', { sessionId: metadata.sessionId, error });
      }

      this.setState(prev => {
        if (prev.sessions.has(metadata.sessionId)) {
          return prev;
        }

        const rawAgentType = metadata.agentType || 'agentic';
        const descriptor = descriptorFromAgentType(rawAgentType);
        const backendAgentType = getBackendAgentType(descriptor);

        const session: Session = {
          sessionId: metadata.sessionId,
          title: metadata.sessionName,
          titleStatus: 'generated',
          dialogTurns: [],
          status: 'idle',
          config: {
            agentType: backendAgentType,
            modelName: metadata.modelName,
          },
          createdAt: metadata.createdAt,
          lastActiveAt: metadata.lastActiveAt,
          lastFinishedAt,
          updatedAt: metadata.lastActiveAt ?? metadata.createdAt,
          error: null,
          isHistorical: true,
          todos: metadata.todos || [],
          maxContextTokens,
          descriptor,
          workspacePath: metadata.workspacePath || workspacePath,
          storageScope: metadata.storageScope || storageScope || descriptor.storageScope,
          parentSessionId: relationship.parentSessionId,
          sessionKind: relationship.sessionKind,
          btwThreads: [],
          btwOrigin: relationship.btwOrigin,
          hasUnreadCompletion: metadata.unreadCompletion,
          needsUserAttention: metadata.needsUserAttention,
          isTransient: false,
        };

        const newSessions = new Map(prev.sessions);
        newSessions.set(metadata.sessionId, session);

        insertedCount += 1;

        return {
          ...prev,
          sessions: newSessions,
        };
      });
    };

    await Promise.all(metadataList.map(processSession));
    this.markWorkspaceMetadataPreloaded(workspacePath);
    return insertedCount;
  }

  public async initializeFromDisk(
    workspacePath: string,
    storageScope?: import('@/shared/types/session-history').SessionStorageScope
  ): Promise<void> {
    try {
      const { sessionAPI } = await import('@/infrastructure/api');
      const sessions = await sessionAPI.listSessions(workspacePath, storageScope);
      await this.hydrateWorkspaceSessionsMetadata(sessions, workspacePath, storageScope);
    } catch (error) {
      log.error('Failed to load persisted sessions', error);
    }
  }

  /**
   * Lazy load session history (convert historical data to FlowChat format)
   */
  public async loadSessionHistory(
    sessionId: string,
    workspacePath: string,
    limit?: number,
    storageScope?: import('@/shared/types/session-history').SessionStorageScope
  ): Promise<void> {
    try {
      const { stateMachineManager } = await import('../state-machine');
      stateMachineManager.getOrCreate(sessionId);
      
      try {
        const { agentAPI } = await import('@/infrastructure/api');
        await agentAPI.restoreSession(sessionId, workspacePath, storageScope);
      } catch (error) {
        log.warn('Backend session restore failed (may be new session)', { sessionId, error });
      }
      
      const { sessionAPI } = await import('@/infrastructure/api');
      const turns = await sessionAPI.loadSessionTurns(
        sessionId,
        workspacePath,
        limit,
        storageScope
      );
      
      const dialogTurns = this.convertToDialogTurns(turns);
      
      this.setState(prev => {
        const session = prev.sessions.get(sessionId);
        if (!session) return prev;
        
        const updatedSession = {
          ...session,
          dialogTurns,
          isHistorical: false,
          storageScope: session.storageScope ?? storageScope,
        };
        
        const newSessions = new Map(prev.sessions);
        newSessions.set(sessionId, updatedSession);
        
        return {
          ...prev,
          sessions: newSessions,
        };
      });
      this.markSessionHistoryWarmed(sessionId);
      await this.hydrateExecutionProjections(dialogTurns);
    } catch (error) {
      log.error('Failed to load session history', { sessionId, error });
      throw error;
    }
  }

  private async hydrateExecutionProjections(dialogTurns: DialogTurn[]): Promise<void> {
    const projections = dialogTurns.flatMap(turn =>
      turn.modelRounds.flatMap(round =>
        round.items
          .filter((item): item is FlowToolItem => item.type === 'tool')
          .map(item => item.executionProjection)
          .filter(Boolean)
      )
    );

    if (projections.length === 0) {
      return;
    }

    const { executionGraphStore } = await import('../execution');
    projections.forEach(projection => {
      if (
        projection &&
        projection.id &&
        projection.parentSessionId &&
        projection.parentToolId &&
        projection.childSessionId
      ) {
        executionGraphStore.hydrateNode(projection);
      }
    });
  }

  /**
   * Strip agent-internal XML wrapper tags from persisted user inputs.
   */
  private cleanRemoteUserInput(raw: string): string {
    const s = raw.trim();
    const userQueryMatch = s.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/);
    if (userQueryMatch) {
      return userQueryMatch[1].trim();
    }

    return s
      .replace(/<system(?:_|-)reminder>[\s\S]*?<\/system(?:_|-)reminder>/g, '')
      .trim();
  }

  /**
   * Convert DialogTurnData to FlowChat DialogTurn format
   */
  private convertToDialogTurns(turns: any[]): DialogTurn[] {
    return turns.map(turn => {
      const metadata = turn.userMessage.metadata;
      const metaImages = metadata?.images;
      const hasImages = Array.isArray(metaImages) && metaImages.length > 0;
      const images = hasImages
        ? metaImages.map((img: any) => ({
            id: img.id || img.name || `img-${Date.now()}`,
            name: img.name || 'image',
            dataUrl: img.data_url,
            imagePath: img.image_path,
            mimeType: img.mime_type,
          }))
        : undefined;

      const displayContent =
        metadata?.original_text || this.cleanRemoteUserInput(turn.userMessage.content);
      const triggerSource = (metadata?.triggerSource || turn.userMessage.triggerSource) as
        import('@/shared/types/session-history').TriggerSource | undefined;
      const normalizedTurnStatus = normalizeRecoveredTurnStatus(turn.status, {
        error: turn.error,
        modelRounds: turn.modelRounds,
      });

      return {
      id: turn.turnId,
      sessionId: turn.sessionId,
      kind: turn.kind || 'user_dialog',
      userMessage: {
        id: turn.userMessage.id,
        type: 'user' as const,
        content: displayContent,
        timestamp: turn.userMessage.timestamp,
        hasImages,
        triggerSource,
        metadata,
        images,
      },
      followUpUserMessages: Array.isArray(turn.followUpUserMessages)
        ? turn.followUpUserMessages.map((message: any) => ({
            id: message.id,
            content: this.cleanRemoteUserInput(message.content || ''),
            timestamp: message.timestamp,
            kind: message.kind || 'guidance',
            status: message.status || 'applied',
            guidanceId: message.guidanceId,
            sourceTurnId: message.sourceTurnId,
            appliedAt: message.appliedAt,
            error: message.error,
            hasImages: message.hasImages,
            imageCount: message.imageCount,
            metadata: message.metadata,
          }))
        : undefined,
      modelRounds: turn.modelRounds.map((round: any) => {
        const normalizedRoundStatus = normalizeRecoveredRoundStatus(round.status, normalizedTurnStatus);

        return {
          id: round.id,
          turnId: round.turnId,
          index: round.roundIndex ?? 0,
          items: [
            ...round.textItems.map((text: any) => ({
              id: text.id,
              type: 'text' as const,
              content: text.content,
              isStreaming: false,
              isMarkdown: text.isMarkdown !== undefined ? text.isMarkdown : true,
              timestamp: text.timestamp,
              status: normalizeRecoveredTextStatus(text.status, normalizedTurnStatus),
              orderIndex: text.orderIndex,
            })),
            ...round.toolItems.map((tool: any) => {
              const status = normalizeRecoveredToolStatus(
                tool.status,
                normalizedTurnStatus,
                tool.toolResult,
                { preservePendingConfirmation: true },
              );
              return {
              id: tool.id,
              type: 'tool' as const,
              toolName: tool.toolName,
              interruptionReason:
                tool.interruptionReason === 'app_restart'
                  ? 'app_restart'
                  : isTransientToolStatus(tool.status)
                    ? 'app_restart'
                    : undefined,
              toolCall: tool.toolCall,
              toolResult: tool.toolResult,
              aiIntent: tool.aiIntent,
              startTime: tool.startTime,
              endTime: tool.endTime,
              executionProjection: tool.executionProjection,
              runtime: recoverToolRuntime(tool, status),
              timestamp: tool.startTime,
              status,
              orderIndex: tool.orderIndex,
              };
            }),
            ...(round.thinkingItems || []).map((thinking: any) => ({
              id: thinking.id,
              type: 'thinking' as const,
              content: thinking.content,
              isStreaming: false,
              isCollapsed: thinking.isCollapsed ?? true,
              timestamp: thinking.timestamp,
              status: normalizeRecoveredThinkingStatus(thinking.status, normalizedTurnStatus),
              orderIndex: thinking.orderIndex,
            })),
          ].sort((a: any, b: any) => {
            const aIndex = a.orderIndex !== undefined ? a.orderIndex : a.timestamp || 0;
            const bIndex = b.orderIndex !== undefined ? b.orderIndex : b.timestamp || 0;
            
            return aIndex - bIndex;
          }),
          isStreaming: false,
          isComplete: normalizedRoundStatus !== 'pending' && normalizedRoundStatus !== 'streaming',
          status: normalizedRoundStatus,
          startTime: round.startTime ?? round.timestamp,
          endTime: round.endTime,
          timestamp: round.timestamp,
        };
      }),
      timestamp: turn.timestamp,
      status: normalizedTurnStatus,
      startTime: turn.startTime,
      endTime: turn.endTime,
      backendTurnIndex: turn.turnIndex,
    };
    });
  }

  public setDialogTurnTodos(sessionId: string, turnId: string, todos: import('../types/flow-chat').TodoItem[]): void {
    this.setState(prev => {
      const session = prev.sessions.get(sessionId);
      if (!session) {
        log.warn('Session not found, cannot set turn todos', { sessionId, turnId });
        return prev;
      }

      const turnIndex = session.dialogTurns.findIndex(turn => turn.id === turnId);
      if (turnIndex === -1) {
        log.warn('Dialog turn not found, cannot set turn todos', { sessionId, turnId });
        return prev;
      }

      const updatedTurns = [...session.dialogTurns];
      updatedTurns[turnIndex] = {
        ...updatedTurns[turnIndex],
        todos: [...todos]
      };

      const updatedSession = {
        ...session,
        dialogTurns: updatedTurns,
        lastActiveAt: Date.now()
      };

      const newSessions = new Map(prev.sessions);
      newSessions.set(sessionId, updatedSession);

      return {
        ...prev,
        sessions: newSessions
      };
    });
  }

  public getDialogTurnTodos(sessionId: string, turnId: string): import('../types/flow-chat').TodoItem[] {
    const session = this.state.sessions.get(sessionId);
    if (!session) return [];

    const turn = session.dialogTurns.find(t => t.id === turnId);
    return turn?.todos || [];
  }
  
  public deleteTodo(sessionId: string, todoId: string): void {
    this.setState(prev => {
      const session = prev.sessions.get(sessionId);
      if (!session) {
        log.warn('Session not found, cannot delete todo', { sessionId, todoId });
        return prev;
      }

      const todos = session.todos || [];
      const updatedTodos = todos.filter(t => t.id !== todoId);

      const updatedSession = {
        ...session,
        todos: updatedTodos,
        lastActiveAt: Date.now()
      };

      const newSessions = new Map(prev.sessions);
      newSessions.set(sessionId, updatedSession);

      return {
        ...prev,
        sessions: newSessions
      };
    });
  }

  /**
   * Get all todo items for session (aggregates todos from all DialogTurns)
   * Mainly used by PlannerPanel to display overall progress
   */
  public getTodos(sessionId: string): import('../types/flow-chat').TodoItem[] {
    const session = this.state.sessions.get(sessionId);
    if (!session) return [];
    
    const allTodos: import('../types/flow-chat').TodoItem[] = [];
    session.dialogTurns.forEach(turn => {
      if (turn.todos && turn.todos.length > 0) {
        allTodos.push(...turn.todos);
      }
    });
    
    if (session.todos && session.todos.length > 0) {
      allTodos.push(...session.todos);
    }
    
    return allTodos;
  }

  public setTodos(sessionId: string, todos: import('../types/flow-chat').TodoItem[]): void {
    this.setState(prev => {
      const session = prev.sessions.get(sessionId);
      if (!session) {
        return prev;
      }

      const updatedSession = {
        ...session,
        todos: [...todos],
        lastActiveAt: Date.now()
      };

      const newSessions = new Map(prev.sessions);
      newSessions.set(sessionId, updatedSession);

      return {
        ...prev,
        sessions: newSessions
      };
    });
  }
}

export const flowChatStore = FlowChatStore.getInstance();
