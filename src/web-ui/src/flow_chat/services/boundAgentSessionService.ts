import { openWorkspaceSession } from '@/app/navigation/workspaceNavigation';
import type { WorkspaceSurfaceContext } from '@/app/navigation/workspaceSurfaceTypes';
import { sessionAPI } from '@/infrastructure/api/service-api/SessionAPI';
import { createLogger } from '@/shared/utils/logger';
import type {
  AgentSessionBindingMetadata,
  SessionCustomMetadata,
  SessionMetadata,
  SessionStorageScope,
} from '@/shared/types/session-history';
import {
  appScopeIdentity,
  workspacePathFromAppScope,
} from '@/shared/types/app-scope';
import {
  getBackendAgentType,
  type SessionDescriptor,
} from '../domain/sessionDescriptor';
import { flowChatStore } from '../store/FlowChatStore';
import type { Session } from '../types/flow-chat';
import { flowChatManager } from './FlowChatManager';

const log = createLogger('BoundAgentSessionService');

export interface OpenBoundAgentSessionRequest {
  descriptor: SessionDescriptor;
  binding: AgentSessionBindingMetadata;
  sessionName: string;
  storageScope?: SessionStorageScope;
  customMetadata?: SessionCustomMetadata;
  context?: WorkspaceSurfaceContext | null;
  onOpened?: (session: Session) => void;
}

function normalizePart(value?: string | number | null): string {
  return String(value ?? 'default').trim().replace(/\\/g, '/').toLowerCase() || 'default';
}

export function buildBoundAgentSessionKey(binding: AgentSessionBindingMetadata): string {
  return [
    'bound-agent',
    normalizePart(binding.intent.agentType),
    normalizePart(binding.intent.mode),
    normalizePart(binding.subject.kind),
    normalizePart(binding.subject.id),
    appScopeIdentity(binding.scope),
  ].join(':');
}

function bindingMatches(
  binding: AgentSessionBindingMetadata | undefined,
  target: AgentSessionBindingMetadata
): boolean {
  if (!binding) return false;
  return (
    normalizePart(binding.intent.agentType) === normalizePart(target.intent.agentType) &&
    normalizePart(binding.intent.mode) === normalizePart(target.intent.mode) &&
    normalizePart(binding.subject.kind) === normalizePart(target.subject.kind) &&
    normalizePart(binding.subject.id) === normalizePart(target.subject.id) &&
    appScopeIdentity(binding.scope) === appScopeIdentity(target.scope)
  );
}

function compareSessionRecency(left: Session, right: Session): number {
  const leftTime = left.updatedAt ?? left.lastActiveAt ?? left.createdAt ?? 0;
  const rightTime = right.updatedAt ?? right.lastActiveAt ?? right.createdAt ?? 0;
  return rightTime - leftTime;
}

function compareMetadataRecency(left: SessionMetadata, right: SessionMetadata): number {
  const leftTime = left.lastActiveAt ?? left.createdAt ?? 0;
  const rightTime = right.lastActiveAt ?? right.createdAt ?? 0;
  return rightTime - leftTime;
}

function findInMemoryBoundSessionId(binding: AgentSessionBindingMetadata): string | null {
  const match = Array.from(flowChatStore.getState().sessions.values())
    .filter(session => bindingMatches(session.customMetadata?.agentSessionBinding, binding))
    .sort(compareSessionRecency)[0];
  return match?.sessionId ?? null;
}

async function findPersistedBoundSessionId(
  binding: AgentSessionBindingMetadata,
  storageScope: SessionStorageScope
): Promise<string | null> {
  try {
    const boundWorkspacePath = workspacePathFromAppScope(binding.scope);
    const workspacePath = storageScope === 'agentic_os'
      ? undefined
      : boundWorkspacePath || undefined;
    const persisted = await sessionAPI.listSessions(workspacePath, storageScope);
    const match = persisted
      .filter(meta => bindingMatches(meta.customMetadata?.agentSessionBinding, binding))
      .sort(compareMetadataRecency)[0];

    if (!match) return null;

    await flowChatStore.hydrateWorkspaceSessionsMetadata(
      [match],
      match.workspacePath || boundWorkspacePath || '',
      match.storageScope || storageScope,
    );
    return match.sessionId;
  } catch (error) {
    log.warn('Failed to search persisted bound agent sessions', {
      agentType: binding.intent.agentType,
      subjectKind: binding.subject.kind,
      subjectId: binding.subject.id,
      error,
    });
    return null;
  }
}

async function findExistingBoundSessionId(
  binding: AgentSessionBindingMetadata,
  storageScope: SessionStorageScope
): Promise<string | null> {
  return findInMemoryBoundSessionId(binding) ||
    await findPersistedBoundSessionId(binding, storageScope);
}

function mergeCustomMetadata(
  existing: SessionCustomMetadata | undefined,
  incoming: SessionCustomMetadata | undefined,
  binding: AgentSessionBindingMetadata,
): SessionCustomMetadata {
  return {
    ...(existing || {}),
    ...(incoming || {}),
    agentSessionBinding: binding,
  };
}

function updateBoundSessionMetadata(
  sessionId: string,
  request: OpenBoundAgentSessionRequest,
  storageScope: SessionStorageScope,
): Session | null {
  let updatedSession: Session | null = null;
  const backendAgentType = getBackendAgentType(request.descriptor);

  flowChatStore.setState(prev => {
    const session = prev.sessions.get(sessionId);
    if (!session) return prev;

    const nextCustomMetadata = mergeCustomMetadata(
      session.customMetadata,
      request.customMetadata,
      request.binding,
    );
    const nextConfigCustomMetadata = mergeCustomMetadata(
      session.config.customMetadata,
      request.customMetadata,
      request.binding,
    );
    const nextWorkspacePath = workspacePathFromAppScope(request.binding.scope);

    updatedSession = {
      ...session,
      descriptor: request.descriptor,
      title: request.sessionName || session.title,
      titleStatus: request.sessionName ? 'generated' : session.titleStatus,
      workspacePath: nextWorkspacePath,
      storageScope,
      updatedAt: Date.now(),
      config: {
        ...session.config,
        agentType: backendAgentType,
        workspacePath: nextWorkspacePath,
        storageScope,
        sessionName: request.sessionName || session.config.sessionName,
        customMetadata: nextConfigCustomMetadata,
      },
      customMetadata: nextCustomMetadata,
    };

    const nextSessions = new Map(prev.sessions);
    nextSessions.set(sessionId, updatedSession);
    return {
      ...prev,
      sessions: nextSessions,
    };
  });

  return updatedSession;
}

export async function openBoundAgentSession(
  request: OpenBoundAgentSessionRequest
): Promise<Session | null> {
  const binding: AgentSessionBindingMetadata = {
    ...request.binding,
    updatedAt: Date.now(),
  };
  const storageScope = request.storageScope ?? request.descriptor.storageScope;
  const normalizedRequest: OpenBoundAgentSessionRequest = {
    ...request,
    binding,
  };

  const existingSessionId = await findExistingBoundSessionId(binding, storageScope);
  if (existingSessionId) {
    const session = updateBoundSessionMetadata(existingSessionId, normalizedRequest, storageScope);
    await flowChatManager.persistSessionMetadata(existingSessionId);
    await openWorkspaceSession(existingSessionId, { context: request.context });
    if (session) request.onOpened?.(session);
    return session;
  }

  const sessionId = await flowChatManager.createChatSession(
    {
      storageScope,
      workspacePath: workspacePathFromAppScope(binding.scope),
      sessionName: request.sessionName,
      creationDeduplicationKey: buildBoundAgentSessionKey(binding),
      customMetadata: mergeCustomMetadata(undefined, request.customMetadata, binding),
    },
    request.descriptor,
  );

  const session = updateBoundSessionMetadata(sessionId, normalizedRequest, storageScope);
  await flowChatManager.persistSessionMetadata(sessionId);
  await openWorkspaceSession(sessionId, { context: request.context });
  if (session) request.onOpened?.(session);
  return session;
}
