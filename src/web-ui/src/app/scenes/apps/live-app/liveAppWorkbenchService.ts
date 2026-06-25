import { liveAppAPI } from '@/infrastructure/api/service-api/LiveAppAPI';
import type { LiveApp, LiveAppMeta } from '@/infrastructure/api/service-api/LiveAppAPI';
import { agentAPI } from '@/infrastructure/api/service-api/AgentAPI';
import { sessionAPI } from '@/infrastructure/api/service-api/SessionAPI';
import { openWorkspaceScene, openWorkspaceSession } from '@/app/navigation/workspaceNavigation';
import type { WorkspaceSceneId } from '@/app/navigation/workspaceSceneTypes';
import { flowChatManager } from '@/flow_chat/services/FlowChatManager';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import {
  getBackendAgentType,
  getLiveAppWorkbenchSessionDescriptor,
  type SessionDescriptor,
} from '@/flow_chat/domain/sessionDescriptor';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import type { WorkspaceSurfaceContext } from '@/app/navigation/workspaceSurfaceTypes';
import { useWorkStore } from '@/app/agentic-os/work/data/workStore';
import type { WorkRecord, WorkScope } from '@/app/agentic-os/work/domain/workTypes';
import type { LiveAppWorkbenchSessionMetadata, SessionMetadata } from '@/shared/types/session-history';
import {
  appScopeIdentity,
  normalizeAppScope,
  systemAppScope,
  type AppScope,
  workspacePathFromAppScope,
} from '@/shared/types/app-scope';
import {
  buildLiveAppWorkbenchMetadata,
  isCompositeLiveApp,
} from './liveAppInteraction';
import { resolveLiveAppMeta } from './liveAppI18n';
import type { Session } from '@/flow_chat/types/flow-chat';

const log = createLogger('LiveAppWorkbenchService');

export interface OpenLiveAppOptions {
  entityId?: string | null;
  locale?: string | null;
  scope?: AppScope | null;
  theme?: string | null;
  context?: WorkspaceSurfaceContext | null;
}

function agentAppIdFromWorkbenchMetadata(metadata: LiveAppWorkbenchSessionMetadata): string | null {
  const value = metadata.chat?.agentAppId;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function liveAppWorkbenchDescriptor(metadata?: LiveAppWorkbenchSessionMetadata): SessionDescriptor {
  return getLiveAppWorkbenchSessionDescriptor(
    metadata ? agentAppIdFromWorkbenchMetadata(metadata) : undefined,
  );
}

function workbenchKey(
  metadata: Pick<LiveAppWorkbenchSessionMetadata, 'profile' | 'appId' | 'entityId' | 'scope'>
): string {
  return [
    'live-app-workbench',
    metadata.profile,
    metadata.appId,
    metadata.entityId || 'default',
    appScopeIdentity(metadata.scope),
  ].join(':');
}

function findExistingWorkbenchSession(metadata: LiveAppWorkbenchSessionMetadata): string | null {
  const candidates = Array.from(flowChatStore.getState().sessions.values())
    .filter(session => workbenchBindingMatches(session.customMetadata?.liveAppWorkbench, metadata))
    .sort(compareWorkbenchSessionRecency);
  return candidates[0]?.sessionId ?? null;
}

function workbenchBindingMatches(
  binding: LiveAppWorkbenchSessionMetadata | undefined,
  metadata: LiveAppWorkbenchSessionMetadata
): boolean {
  if (!binding) return false;
  return (
    binding.appId === metadata.appId &&
    binding.profile === metadata.profile &&
    (binding.entityId || 'default') === (metadata.entityId || 'default') &&
    appScopeIdentity(binding.scope) === appScopeIdentity(metadata.scope)
  );
}

function compareWorkbenchSessionRecency(left: Session, right: Session): number {
  const leftTime = left.updatedAt ?? left.lastActiveAt ?? left.createdAt ?? 0;
  const rightTime = right.updatedAt ?? right.lastActiveAt ?? right.createdAt ?? 0;
  return rightTime - leftTime;
}

function comparePersistedSessionRecency(left: SessionMetadata, right: SessionMetadata): number {
  const leftTime = left.lastActiveAt ?? left.createdAt ?? 0;
  const rightTime = right.lastActiveAt ?? right.createdAt ?? 0;
  return rightTime - leftTime;
}

async function findPersistedWorkbenchSession(metadata: LiveAppWorkbenchSessionMetadata): Promise<string | null> {
  try {
    const persisted = await sessionAPI.listSessions(undefined, 'agentic_os');
    const match = persisted
      .filter(meta => workbenchBindingMatches(meta.customMetadata?.liveAppWorkbench, metadata))
      .sort(comparePersistedSessionRecency)[0];

    if (!match) return null;

    const workspacePath =
      match.workspacePath ||
      workspacePathFromAppScope(match.customMetadata?.liveAppWorkbench?.scope) ||
      workspacePathFromAppScope(metadata.scope) ||
      '';
    await flowChatStore.hydrateWorkspaceSessionsMetadata([match], workspacePath, 'agentic_os');
    return match.sessionId;
  } catch (error) {
    log.warn('Failed to search persisted Live App workbench sessions', { appId: metadata.appId, error });
    return null;
  }
}

async function findExistingWorkbenchSessionId(
  metadata: LiveAppWorkbenchSessionMetadata
): Promise<string | null> {
  const inMemorySessionId = findExistingWorkbenchSession(metadata);
  if (inMemorySessionId) return inMemorySessionId;
  return findPersistedWorkbenchSession(metadata);
}

function updateSessionWorkbenchMetadata(
  sessionId: string,
  metadata: LiveAppWorkbenchSessionMetadata
): void {
  const descriptor = liveAppWorkbenchDescriptor(metadata);
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
          liveAppWorkbench: metadata,
        },
      },
      customMetadata: {
        ...(session.customMetadata || {}),
        liveAppWorkbench: metadata,
      },
    });
    return {
      ...prev,
      sessions: nextSessions,
    };
  });
}

async function syncWorkbenchSessionWorkspace(
  sessionId: string,
  metadata: LiveAppWorkbenchSessionMetadata
): Promise<void> {
  const workspacePath = workspacePathFromAppScope(metadata.scope);
  if (!workspacePath) return;

  try {
    await agentAPI.ensureCoordinatorSession({
      sessionId,
      workspacePath,
      storageScope: 'agentic_os',
    });
    await agentAPI.updateSessionWorkspace({ sessionId, workspacePath });
  } catch (error) {
    log.error('Failed to sync Live App workbench session workspace', {
      sessionId,
      appId: metadata.appId,
      workspacePath,
      error,
    });
    throw error;
  }
}

function validateCompositeInteraction(app: LiveApp | LiveAppMeta): void {
  const interaction = app.interaction;
  if (!interaction || interaction.mode !== 'composite') {
    return;
  }

  const chatBackendId = interaction.chat?.backendId?.trim();
  if (!chatBackendId) {
    return;
  }

  const hasBackend = app.backends?.some(backend => backend.id === chatBackendId);
  if (!hasBackend) {
    throw new Error(`Live App declares chat backend "${chatBackendId}" but no matching backend binding exists`);
  }
}

async function loadLiveApp(appOrId: LiveApp | LiveAppMeta | string, options: OpenLiveAppOptions): Promise<LiveApp | LiveAppMeta> {
  if (typeof appOrId !== 'string') {
    return appOrId;
  }
  const scope = normalizeAppScope(options.scope);
  return liveAppAPI.getLiveApp(
    appOrId,
    options.theme || undefined,
    workspacePathFromAppScope(scope),
  );
}

function workScopeFromAppScope(scope: AppScope): WorkScope {
  const workspacePath = workspacePathFromAppScope(scope);
  return workspacePath ? { kind: 'workspace', workspacePath } : { kind: 'system' };
}

function workContext(work: WorkRecord): WorkspaceSurfaceContext {
  return { kind: 'work', workId: work.id };
}

async function resolveLiveAppWork(
  app: LiveApp | LiveAppMeta,
  scope: AppScope,
  locale?: string | null,
): Promise<WorkRecord> {
  const displayMeta = resolveLiveAppMeta(app, locale || undefined);
  const title = displayMeta.name || app.name || app.id;
  const response = await useWorkStore.getState().resolveAppWork({
    app: { kind: 'live_app', appId: app.id },
    intent: 'run',
    title,
    objective: title,
    scope: workScopeFromAppScope(scope),
    visibility: 'primary',
    primarySurfacePolicy: 'live_app',
    assignment: {
      kind: 'application',
      applicationId: app.id,
    },
    appRefs: [
      { app: { kind: 'live_app', appId: app.id }, role: 'executor' },
    ],
  });
  return response.work;
}

export async function ensureLiveAppWorkbenchSession(
  app: LiveApp | LiveAppMeta,
  options: OpenLiveAppOptions = {}
): Promise<string> {
  validateCompositeInteraction(app);
  const scope = normalizeAppScope(options.scope);
  const workspacePath = workspacePathFromAppScope(scope);

  const metadata = buildLiveAppWorkbenchMetadata(app, {
    entityId: options.entityId,
    locale: options.locale,
    scope,
  });
  const descriptor = liveAppWorkbenchDescriptor(metadata);
  const existingSessionId = await findExistingWorkbenchSessionId(metadata);
  if (existingSessionId) {
    updateSessionWorkbenchMetadata(existingSessionId, metadata);
    await syncWorkbenchSessionWorkspace(existingSessionId, metadata);
    await flowChatManager.persistSessionMetadata(existingSessionId);
    await openWorkspaceSession(existingSessionId, { context: options.context });
    return existingSessionId;
  }

  const title = metadata.interactionTitle || metadata.appName;
  const sessionId = await flowChatManager.createChatSession(
    {
      storageScope: 'agentic_os',
      workspacePath,
      sessionName: title,
      creationDeduplicationKey: workbenchKey(metadata),
      customMetadata: {
        liveAppWorkbench: metadata,
      },
    },
    descriptor,
  );

  updateSessionWorkbenchMetadata(sessionId, metadata);
  await syncWorkbenchSessionWorkspace(sessionId, metadata);
  await flowChatManager.persistSessionMetadata(sessionId);
  await openWorkspaceSession(sessionId, { context: options.context });
  return sessionId;
}

export async function openLiveAppSurface(
  appOrId: LiveApp | LiveAppMeta | string,
  options: OpenLiveAppOptions = {}
): Promise<void> {
  const scope = normalizeAppScope(options.scope ?? systemAppScope());
  const workspacePath = workspacePathFromAppScope(scope);
  const app = await loadLiveApp(appOrId, options);
  void liveAppAPI.recordRecentLiveApp(app.id)
    .catch(error => log.warn('Failed to persist recent Live App', { appId: app.id, error }));
  if (!isCompositeLiveApp(app)) {
    openWorkspaceScene(`live-app:${app.id}` as WorkspaceSceneId, {
      workspacePath: workspacePath ?? null,
      appScope: scope,
      context: options.context,
    });
    return;
  }

  try {
    const sessionId = await ensureLiveAppWorkbenchSession(app, { ...options, scope });
    if (options.context?.kind === 'work') {
      await useWorkStore.getState().linkSessionToWork({
        workId: options.context.workId,
        sessionId,
        workspacePath,
        surface: { kind: 'agent_session', sessionId },
        setPrimary: false,
      });
    }
  } catch (error) {
    log.error('Failed to open Live App workbench', { appId: app.id, error });
    notificationService.error(error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export async function openLiveApp(
  appOrId: LiveApp | LiveAppMeta | string,
  options: OpenLiveAppOptions = {}
): Promise<void> {
  const scope = normalizeAppScope(options.scope ?? systemAppScope());
  const app = await loadLiveApp(appOrId, { ...options, scope });
  const work = await resolveLiveAppWork(app, scope, options.locale);
  await openLiveAppSurface(app, {
    ...options,
    scope,
    context: workContext(work),
  });
}
