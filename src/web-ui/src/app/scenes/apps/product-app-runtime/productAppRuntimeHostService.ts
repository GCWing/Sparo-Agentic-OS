import { agentAPI } from '@/infrastructure/api/service-api/AgentAPI';
import { sessionAPI } from '@/infrastructure/api/service-api/SessionAPI';
import { openWorkspaceScene, openWorkspaceSession } from '@/app/navigation/workspaceNavigation';
import type { WorkspaceSceneId } from '@/app/navigation/workspaceSceneTypes';
import { flowChatManager } from '@/flow_chat/services/FlowChatManager';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import {
  getBackendAgentType,
  getProductAppRuntimeSessionDescriptor,
  type SessionDescriptor,
} from '@/flow_chat/domain/sessionDescriptor';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import { useWorkStore } from '@/app/agentic-os/work/data/workStore';
import type { ProductAppRuntimeSessionMetadata, SessionMetadata } from '@/shared/types/session-history';
import {
  appScopeIdentity,
  normalizeAppScope,
  workspacePathFromAppScope,
} from '@/shared/types/app-scope';
import {
  buildProductAppRuntimeMetadata,
  isCompositeProductAppRuntimeHost,
} from './productAppRuntimeInteraction';
import type { Session } from '@/flow_chat/types/flow-chat';
import type {
  OpenProductAppRuntimeOptions,
  ProductAppRuntimeHostTarget,
} from './productAppRuntimeOpenTypes';
import type {
  ProductAppHostSurface,
  ProductAppHostSurfaceMeta,
} from '@/infrastructure/api/service-api/ProductAppRuntimeHostAPI';

const log = createLogger('ProductAppRuntimeHostService');

function createOptimisticSessionId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `product-app-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function navigationIsCurrent(options: OpenProductAppRuntimeOptions): boolean {
  return options.isNavigationCurrent?.() !== false;
}

function agentComponentIdFromRuntimeMetadata(metadata: ProductAppRuntimeSessionMetadata): string | null {
  const value = metadata.chat?.agentComponentId;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function productAppRuntimeDescriptor(metadata?: ProductAppRuntimeSessionMetadata): SessionDescriptor {
  return getProductAppRuntimeSessionDescriptor(
    metadata ? agentComponentIdFromRuntimeMetadata(metadata) : undefined,
  );
}

function runtimeKey(
  metadata: Pick<ProductAppRuntimeSessionMetadata, 'profile' | 'appId' | 'hostSurfaceId' | 'entityId' | 'scope' | 'runtimeContext'>
): string {
  return [
    'product-app-runtime',
    metadata.profile,
    metadata.appId,
    metadata.hostSurfaceId,
    metadata.entityId || 'default',
    appScopeIdentity(metadata.scope),
    metadata.runtimeContext?.workId || 'no-work',
    metadata.runtimeContext?.runtimeInstanceId || 'no-runtime',
  ].join(':');
}

function findExistingRuntimeSession(metadata: ProductAppRuntimeSessionMetadata): string | null {
  const candidates = Array.from(flowChatStore.getState().sessions.values())
    .filter(session => runtimeBindingMatches(session.customMetadata?.productAppRuntime, metadata))
    .sort(compareRuntimeSessionRecency);
  return candidates[0]?.sessionId ?? null;
}

function runtimeBindingMatches(
  binding: ProductAppRuntimeSessionMetadata | undefined,
  metadata: ProductAppRuntimeSessionMetadata
): boolean {
  if (!binding) return false;
  return (
    binding.appId === metadata.appId &&
    binding.hostSurfaceId === metadata.hostSurfaceId &&
    binding.profile === metadata.profile &&
    (binding.entityId || 'default') === (metadata.entityId || 'default') &&
    appScopeIdentity(binding.scope) === appScopeIdentity(metadata.scope) &&
    (binding.runtimeContext?.workId || '') === (metadata.runtimeContext?.workId || '') &&
    (binding.runtimeContext?.runtimeInstanceId || '') ===
      (metadata.runtimeContext?.runtimeInstanceId || '')
  );
}

function compareRuntimeSessionRecency(left: Session, right: Session): number {
  const leftTime = left.updatedAt ?? left.lastActiveAt ?? left.createdAt ?? 0;
  const rightTime = right.updatedAt ?? right.lastActiveAt ?? right.createdAt ?? 0;
  return rightTime - leftTime;
}

function comparePersistedSessionRecency(left: SessionMetadata, right: SessionMetadata): number {
  const leftTime = left.lastActiveAt ?? left.createdAt ?? 0;
  const rightTime = right.lastActiveAt ?? right.createdAt ?? 0;
  return rightTime - leftTime;
}

async function findPersistedRuntimeSession(metadata: ProductAppRuntimeSessionMetadata): Promise<string | null> {
  try {
    const persisted = await sessionAPI.listSessions(undefined, 'agentic_os');
    const match = persisted
      .filter(meta => runtimeBindingMatches(meta.customMetadata?.productAppRuntime, metadata))
      .sort(comparePersistedSessionRecency)[0];

    if (!match) return null;

    const workspacePath =
      match.workspacePath ||
      workspacePathFromAppScope(match.customMetadata?.productAppRuntime?.scope) ||
      workspacePathFromAppScope(metadata.scope) ||
      '';
    await flowChatStore.hydrateWorkspaceSessionsMetadata([match], workspacePath, 'agentic_os');
    return match.sessionId;
  } catch (error) {
    log.warn('Failed to search persisted Product App runtime sessions', { appId: metadata.appId, error });
    return null;
  }
}

async function findExistingRuntimeSessionId(
  metadata: ProductAppRuntimeSessionMetadata
): Promise<string | null> {
  const inMemorySessionId = findExistingRuntimeSession(metadata);
  if (inMemorySessionId) return inMemorySessionId;
  return findPersistedRuntimeSession(metadata);
}

function updateSessionRuntimeMetadata(
  sessionId: string,
  metadata: ProductAppRuntimeSessionMetadata
): void {
  const descriptor = productAppRuntimeDescriptor(metadata);
  const backendAgentType = getBackendAgentType(descriptor);
  const workspacePath = workspacePathFromAppScope(metadata.scope);
  flowChatStore.setState(prev => {
    const session = prev.sessions.get(sessionId);
    if (!session) return prev;

    const nextSessions = new Map(prev.sessions);
    nextSessions.set(sessionId, {
      ...session,
      descriptor,
      title: metadata.interactionTitle || metadata.appName || session.title,
      workspacePath,
      config: {
        ...session.config,
        agentType: backendAgentType,
        workspacePath,
        sessionName: metadata.interactionTitle || metadata.appName || session.config.sessionName,
        customMetadata: {
          ...(session.config.customMetadata || {}),
          productAppRuntime: metadata,
        },
      },
      customMetadata: {
        ...(session.customMetadata || {}),
        productAppRuntime: metadata,
      },
    });
    return {
      ...prev,
      sessions: nextSessions,
    };
  });
}

async function syncRuntimeSessionWorkspace(
  sessionId: string,
  metadata: ProductAppRuntimeSessionMetadata
): Promise<void> {
  const workspacePath = workspacePathFromAppScope(metadata.scope);
  if (!workspacePath) return;

  try {
    await flowChatManager.ensureBackendSession(
      sessionId,
      () => agentAPI.updateSessionWorkspace({ sessionId, workspacePath }),
    );
  } catch (error) {
    log.error('Failed to sync Product App runtime session workspace', {
      sessionId,
      appId: metadata.appId,
      workspacePath,
      error,
    });
    throw error;
  }
}

function validateCompositeInteraction(app: ProductAppHostSurface | ProductAppHostSurfaceMeta): void {
  const interaction = app.interaction;
  if (!interaction || interaction.mode !== 'composite') {
    return;
  }

  if (!interaction.chat) {
    throw new Error(`Product App host surface "${app.id}" uses composite runtime interaction but declares no chat backend`);
  }

  const chatBackendId = interaction.chat.backendId?.trim();
  if (!chatBackendId) {
    throw new Error(`Product App host surface "${app.id}" uses composite runtime interaction but declares no chat backend id`);
  }

  const backend = app.backends?.find(candidate => candidate.id === chatBackendId);
  if (!backend) {
    throw new Error(`Product App host surface declares chat backend "${chatBackendId}" but no matching backend binding exists`);
  }
  if (backend.kind !== 'agentComponent') {
    throw new Error(`Product App host surface chat backend "${chatBackendId}" must bind to an Agent Component`);
  }
  const agentComponentId = interaction.chat.agentComponentId?.trim() || backend.componentId.trim();
  if (!agentComponentId) {
    throw new Error(`Product App host surface chat backend "${chatBackendId}" does not declare an Agent Component id`);
  }
}

export async function ensureProductAppRuntimeSession(
  target: ProductAppRuntimeHostTarget,
  options: OpenProductAppRuntimeOptions = {}
): Promise<string | null> {
  if (!navigationIsCurrent(options)) return null;
  const app = target.hostSurface;
  validateCompositeInteraction(app);
  const scope = normalizeAppScope(options.scope ?? target.scope);
  const workspacePath = workspacePathFromAppScope(scope);

  const metadata = buildProductAppRuntimeMetadata(app, {
    intelligentApp: target.intelligentApp,
    entityId: options.entityId,
    locale: options.locale,
    scope,
    runtimeContext: options.runtimeContext ?? target.runtimeContext,
  });
  const descriptor = productAppRuntimeDescriptor(metadata);
  const existingSessionId = await findExistingRuntimeSessionId(metadata);
  if (!navigationIsCurrent(options)) return null;
  if (existingSessionId) {
    updateSessionRuntimeMetadata(existingSessionId, metadata);
    // Commit the inexpensive conversation shell first. Backend coordinator
    // restore, workspace retargeting, and persistence are readiness work and
    // must not keep the previous screen visible.
    const navigationResult = await openWorkspaceSession(existingSessionId, {
      context: options.context,
      navigationEpoch: options.navigationEpoch,
    });
    if (navigationResult === 'missing') return null;
    await syncRuntimeSessionWorkspace(existingSessionId, metadata);
    await flowChatManager.persistSessionMetadata(existingSessionId);
    return existingSessionId;
  }

  if (!navigationIsCurrent(options)) return null;
  const title = metadata.interactionTitle || metadata.appName;
  const sessionId = createOptimisticSessionId();
  const sessionCreation = flowChatManager.createChatSession(
    {
      storageScope: 'agentic_os',
      workspacePath,
      sessionName: title,
      creationDeduplicationKey: runtimeKey(metadata),
      customMetadata: {
        productAppRuntime: metadata,
      },
      navigate: false,
    },
    descriptor,
    { sessionId, notifyOnError: false },
  );
  let resolvedSessionId = sessionId;
  let sessionCreationError: unknown = null;
  const navigationResult = await openWorkspaceSession(sessionId, {
    context: options.context,
    commitPendingSurface: true,
    navigationEpoch: options.navigationEpoch,
    resolveSession: async () => {
      try {
        resolvedSessionId = await sessionCreation;
      } catch (error) {
        sessionCreationError = error;
        throw error;
      }
      updateSessionRuntimeMetadata(resolvedSessionId, metadata);
      return flowChatStore.getState().sessions.get(resolvedSessionId) ?? null;
    },
  });
  if (
    navigationResult === 'missing'
    || !flowChatStore.getState().sessions.has(resolvedSessionId)
  ) {
    if (navigationResult !== 'superseded' && sessionCreationError) {
      throw sessionCreationError;
    }
    return null;
  }
  await syncRuntimeSessionWorkspace(resolvedSessionId, metadata);
  await flowChatManager.persistSessionMetadata(resolvedSessionId);
  return resolvedSessionId;
}

export async function openProductAppRuntimeHost(
  target: ProductAppRuntimeHostTarget,
  options: OpenProductAppRuntimeOptions = {}
): Promise<void> {
  if (!navigationIsCurrent(options)) return;
  const scope = normalizeAppScope(options.scope ?? target.scope);
  const workspacePath = workspacePathFromAppScope(scope);
  const app = target.hostSurface;
  const runtimeContext = options.runtimeContext ?? target.runtimeContext;
  const context =
    options.context ??
    target.context ??
    { kind: 'work' as const, workId: runtimeContext.workId };

  if (!isCompositeProductAppRuntimeHost(app)) {
    if (!navigationIsCurrent(options)) return;
    openWorkspaceScene(`app-surface:${app.id}` as WorkspaceSceneId, {
      workspacePath: workspacePath ?? null,
      appScope: scope,
      context,
      runtimeContext,
    });
    return;
  }

  try {
    const sessionId = await ensureProductAppRuntimeSession(target, {
      ...options,
      scope,
      context,
      runtimeContext,
    });
    if (!sessionId) return;
    await useWorkStore.getState().linkSessionToWork({
      workId: runtimeContext.workId,
      sessionId,
      workspacePath,
      surface: { kind: 'agent_session', sessionId },
      setPrimary: false,
    });
  } catch (error) {
    log.error('Failed to open Product App runtime', {
      appId: target.intelligentApp.appId,
      hostSurfaceId: app.id,
      error,
    });
    notificationService.error(error instanceof Error ? error.message : String(error));
    throw error;
  }
}
