import { openWorkspaceSession } from '@/app/navigation/workspaceNavigation';
import type { WorkspaceSurfaceContext } from '@/app/navigation/workspaceSurfaceTypes';
import { sessionAPI } from '@/infrastructure/api/service-api/SessionAPI';
import { createLogger } from '@/shared/utils/logger';
import type {
  AgentSessionBindingMetadata,
  SessionCustomMetadata,
  SessionDomain,
  SessionLocator,
  SessionMetadata,
} from '@/shared/types/session-history';
import {
  appScopeIdentity,
  workspacePathFromAppScope,
} from '@/shared/types/app-scope';
import {
  getBackendAgentType,
  sessionDomainForDescriptor,
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
  domain?: SessionDomain;
  existingSession?: {
    locator: SessionLocator;
    workspacePath?: string | null;
  };
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
  domain: SessionDomain,
): Promise<string | null> {
  try {
    const boundWorkspacePath = workspacePathFromAppScope(binding.scope);
    const persisted = await sessionAPI.listSessions(domain);
    const match = persisted
      .filter(meta => bindingMatches(meta.customMetadata?.agentSessionBinding, binding))
      .sort(compareMetadataRecency)[0];

    if (!match) return null;

    await flowChatStore.hydrateWorkspaceSessionsMetadata(
      [match],
      match.workspacePath || boundWorkspacePath || '',
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
  domain: SessionDomain,
): Promise<string | null> {
  return findInMemoryBoundSessionId(binding) ||
    await findPersistedBoundSessionId(binding, domain);
}

async function ensureExistingSessionLoaded(
  locator: SessionLocator,
  workspacePath: string | null | undefined,
): Promise<boolean> {
  const sessionId = locator.session_id;
  if (flowChatStore.getState().sessions.has(sessionId)) return true;

  try {
    const metadata = await sessionAPI.loadSessionMetadata(locator);
    if (!metadata) return false;

    await flowChatStore.hydrateWorkspaceSessionsMetadata(
      [metadata],
      metadata.workspacePath || workspacePath || '',
    );
    return flowChatStore.getState().sessions.has(sessionId);
  } catch (error) {
    log.warn('Failed to load an existing bound agent session', {
      sessionId,
      workspacePath,
      error,
    });
    return false;
  }
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
  domain: SessionDomain,
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
    const nextWorkspacePath = request.existingSession?.workspacePath
      ?? session.workspacePath
      ?? workspacePathFromAppScope(request.binding.scope);

    updatedSession = {
      ...session,
      descriptor: request.descriptor,
      title: request.sessionName || session.title,
      titleStatus: request.sessionName ? 'generated' : session.titleStatus,
      workspacePath: nextWorkspacePath,
      domain,
      updatedAt: Date.now(),
      config: {
        ...session.config,
        agentType: backendAgentType,
        workspacePath: nextWorkspacePath,
        domain,
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
  const workspaceId =
    request.binding.scope.kind === 'workspace'
      ? request.binding.scope.workspaceId
      : undefined;
  const domain =
    request.domain ??
    sessionDomainForDescriptor(request.descriptor, workspaceId);
  const normalizedRequest: OpenBoundAgentSessionRequest = {
    ...request,
    binding,
  };

  let existingSessionId: string | null = null;
  if (request.existingSession) {
    const loaded = await ensureExistingSessionLoaded(
      request.existingSession.locator,
      request.existingSession.workspacePath,
    );
    if (!loaded) {
      log.error('Required bound agent session is unavailable', {
        sessionId: request.existingSession.locator.session_id,
        agentType: binding.intent.agentType,
        subjectKind: binding.subject.kind,
        subjectId: binding.subject.id,
      });
      return null;
    }
    existingSessionId = request.existingSession.locator.session_id;
  } else {
    existingSessionId = await findExistingBoundSessionId(binding, domain);
  }
  if (existingSessionId) {
    const session = updateBoundSessionMetadata(existingSessionId, normalizedRequest, domain);
    await flowChatManager.persistSessionMetadata(existingSessionId);
    await openWorkspaceSession(existingSessionId, { context: request.context });
    if (session) request.onOpened?.(session);
    return session;
  }

  if (request.existingSession) return null;

  const sessionId = await flowChatManager.createChatSession(
    {
      domain,
      workspacePath: workspacePathFromAppScope(binding.scope),
      workspaceId: workspaceId ?? undefined,
      sessionName: request.sessionName,
      creationDeduplicationKey: buildBoundAgentSessionKey(binding),
      customMetadata: mergeCustomMetadata(undefined, request.customMetadata, binding),
    },
    request.descriptor,
  );

  const session = updateBoundSessionMetadata(sessionId, normalizedRequest, domain);
  await flowChatManager.persistSessionMetadata(sessionId);
  await openWorkspaceSession(sessionId, { context: request.context });
  if (session) request.onOpened?.(session);
  return session;
}
