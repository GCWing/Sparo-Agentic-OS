import { surfaceComponentAPI } from '@/infrastructure/api/service-api/SurfaceComponentAPI';
import type { SurfaceComponent, SurfaceComponentMeta } from '@/infrastructure/api/service-api/SurfaceComponentAPI';
import { appCatalogAPI } from '@/infrastructure/api/service-api/AppCatalogAPI';
import { agentAPI } from '@/infrastructure/api/service-api/AgentAPI';
import { sessionAPI } from '@/infrastructure/api/service-api/SessionAPI';
import { openWorkspaceScene, openWorkspaceSession } from '@/app/navigation/workspaceNavigation';
import type { WorkspaceSceneId } from '@/app/navigation/workspaceSceneTypes';
import { flowChatManager } from '@/flow_chat/services/FlowChatManager';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import {
  getBackendAgentType,
  getSurfaceComponentWorkbenchSessionDescriptor,
  type SessionDescriptor,
} from '@/flow_chat/domain/sessionDescriptor';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import type { WorkspaceSurfaceContext } from '@/app/navigation/workspaceSurfaceTypes';
import { useWorkStore } from '@/app/agentic-os/work/data/workStore';
import type { WorkRecord, WorkScope } from '@/app/agentic-os/work/domain/workTypes';
import { resolveProductAppWorkRef } from '@/app/scenes/apps/productAppCatalog';
import type { SurfaceComponentWorkbenchSessionMetadata, SessionMetadata } from '@/shared/types/session-history';
import {
  appScopeFromWorkspacePath,
  appScopeIdentity,
  normalizeAppScope,
  systemAppScope,
  type AppScope,
  workspacePathFromAppScope,
} from '@/shared/types/app-scope';
import {
  buildSurfaceComponentWorkbenchMetadata,
  isCompositeSurfaceComponent,
} from './surfaceComponentInteraction';
import { resolveSurfaceComponentMeta } from './surfaceComponentI18n';
import type { Session } from '@/flow_chat/types/flow-chat';

const log = createLogger('SurfaceComponentWorkbenchService');

export interface OpenSurfaceComponentOptions {
  entityId?: string | null;
  locale?: string | null;
  workspacePath?: string | null;
  scope?: AppScope | null;
  theme?: string | null;
  context?: WorkspaceSurfaceContext | null;
}

export interface OpenProductAppSurfaceRequest {
  productAppId: string;
  surfaceComponentId?: string | null;
  surfaceId?: string | null;
}

function agentComponentIdFromWorkbenchMetadata(metadata: SurfaceComponentWorkbenchSessionMetadata): string | null {
  const value = metadata.chat?.agentComponentId;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function surfaceComponentWorkbenchDescriptor(metadata?: SurfaceComponentWorkbenchSessionMetadata): SessionDescriptor {
  return getSurfaceComponentWorkbenchSessionDescriptor(
    metadata ? agentComponentIdFromWorkbenchMetadata(metadata) : undefined,
  );
}

function workbenchKey(
  metadata: Pick<SurfaceComponentWorkbenchSessionMetadata, 'profile' | 'appId' | 'entityId' | 'scope'>
): string {
  return [
    'surface-component-workbench',
    metadata.profile,
    metadata.appId,
    metadata.entityId || 'default',
    appScopeIdentity(metadata.scope),
  ].join(':');
}

function findExistingWorkbenchSession(metadata: SurfaceComponentWorkbenchSessionMetadata): string | null {
  const candidates = Array.from(flowChatStore.getState().sessions.values())
    .filter(session => workbenchBindingMatches(session.customMetadata?.surfaceComponentWorkbench, metadata))
    .sort(compareWorkbenchSessionRecency);
  return candidates[0]?.sessionId ?? null;
}

function workbenchBindingMatches(
  binding: SurfaceComponentWorkbenchSessionMetadata | undefined,
  metadata: SurfaceComponentWorkbenchSessionMetadata
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

function scopeFromOptions(options: OpenSurfaceComponentOptions): AppScope {
  return normalizeAppScope(
    options.scope
    || appScopeFromWorkspacePath(options.workspacePath)
    || systemAppScope(),
  );
}

async function findPersistedWorkbenchSession(metadata: SurfaceComponentWorkbenchSessionMetadata): Promise<string | null> {
  try {
    const persisted = await sessionAPI.listSessions(undefined, 'agentic_os');
    const match = persisted
      .filter(meta => workbenchBindingMatches(meta.customMetadata?.surfaceComponentWorkbench, metadata))
      .sort(comparePersistedSessionRecency)[0];

    if (!match) return null;

    const workspacePath =
      match.workspacePath ||
      workspacePathFromAppScope(match.customMetadata?.surfaceComponentWorkbench?.scope) ||
      workspacePathFromAppScope(metadata.scope) ||
      '';
    await flowChatStore.hydrateWorkspaceSessionsMetadata([match], workspacePath, 'agentic_os');
    return match.sessionId;
  } catch (error) {
    log.warn('Failed to search persisted Product App workbench sessions', { appId: metadata.appId, error });
    return null;
  }
}

async function findExistingWorkbenchSessionId(
  metadata: SurfaceComponentWorkbenchSessionMetadata
): Promise<string | null> {
  const inMemorySessionId = findExistingWorkbenchSession(metadata);
  if (inMemorySessionId) return inMemorySessionId;
  return findPersistedWorkbenchSession(metadata);
}

function updateSessionWorkbenchMetadata(
  sessionId: string,
  metadata: SurfaceComponentWorkbenchSessionMetadata
): void {
  const descriptor = surfaceComponentWorkbenchDescriptor(metadata);
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
          surfaceComponentWorkbench: metadata,
        },
      },
      customMetadata: {
        ...(session.customMetadata || {}),
        surfaceComponentWorkbench: metadata,
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
  metadata: SurfaceComponentWorkbenchSessionMetadata
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
    log.error('Failed to sync Product App workbench session workspace', {
      sessionId,
      appId: metadata.appId,
      workspacePath,
      error,
    });
    throw error;
  }
}

function validateCompositeInteraction(app: SurfaceComponent | SurfaceComponentMeta): void {
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
    throw new Error(`Product App declares chat backend "${chatBackendId}" but no matching backend binding exists`);
  }
}

async function loadSurfaceComponent(appOrId: SurfaceComponent | SurfaceComponentMeta | string, options: OpenSurfaceComponentOptions): Promise<SurfaceComponent | SurfaceComponentMeta> {
  if (typeof appOrId !== 'string') {
    return appOrId;
  }
  const scope = scopeFromOptions(options);
  return surfaceComponentAPI.getSurfaceComponent(
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

async function resolveSurfaceComponentWork(
  app: SurfaceComponent | SurfaceComponentMeta,
  scope: AppScope,
  locale?: string | null,
): Promise<WorkRecord> {
  const displayMeta = resolveSurfaceComponentMeta(app, locale || undefined);
  const title = displayMeta.name || app.name || app.id;
  const appRef = await resolveProductAppWorkRef(app.id);
  const response = await useWorkStore.getState().resolveAppWork({
    app: appRef,
    intent: 'run',
    title,
    objective: title,
    scope: workScopeFromAppScope(scope),
    visibility: 'primary',
    primarySurfacePolicy: 'application_surface',
    primarySurface: {
      kind: 'application_surface',
      productAppId: app.id,
      surfaceComponentId: `${app.id}-surface`,
      surfaceId: 'primary',
    },
    assignment: {
      kind: 'application',
      applicationId: app.id,
    },
    appRefs: [
      { app: appRef, role: 'executor' },
    ],
  });
  return response.work;
}

export async function ensureSurfaceComponentWorkbenchSession(
  app: SurfaceComponent | SurfaceComponentMeta,
  options: OpenSurfaceComponentOptions = {}
): Promise<string> {
  validateCompositeInteraction(app);
  const scope = normalizeAppScope(options.scope);
  const workspacePath = workspacePathFromAppScope(scope);

  const metadata = buildSurfaceComponentWorkbenchMetadata(app, {
    entityId: options.entityId,
    locale: options.locale,
    scope,
  });
  const descriptor = surfaceComponentWorkbenchDescriptor(metadata);
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
        surfaceComponentWorkbench: metadata,
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

export async function openSurfaceComponentSurface(
  appOrId: SurfaceComponent | SurfaceComponentMeta | string,
  options: OpenSurfaceComponentOptions = {}
): Promise<void> {
  const scope = scopeFromOptions(options);
  const workspacePath = workspacePathFromAppScope(scope);
  const app = await loadSurfaceComponent(appOrId, options);
  void surfaceComponentAPI.recordRecentSurfaceComponent(app.id)
    .catch(error => log.warn('Failed to persist recent Product App', { appId: app.id, error }));
  if (!isCompositeSurfaceComponent(app)) {
    openWorkspaceScene(`app-surface:${app.id}` as WorkspaceSceneId, {
      workspacePath: workspacePath ?? null,
      appScope: scope,
      context: options.context,
    });
    return;
  }

  try {
    const sessionId = await ensureSurfaceComponentWorkbenchSession(app, { ...options, scope });
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
    log.error('Failed to open Product App workbench', { appId: app.id, error });
    notificationService.error(error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export async function openProductAppSurface(
  request: OpenProductAppSurfaceRequest,
  options: OpenSurfaceComponentOptions = {}
): Promise<void> {
  const resolved = await appCatalogAPI.resolveProductAppSurface({
    appId: request.productAppId,
    surfaceComponentId: request.surfaceComponentId,
    surfaceId: request.surfaceId,
  });
  await openSurfaceComponentSurface(resolved.runtimeSurfaceId, options);
}

export async function openSurfaceComponent(
  appOrId: SurfaceComponent | SurfaceComponentMeta | string,
  options: OpenSurfaceComponentOptions = {}
): Promise<void> {
  const scope = scopeFromOptions(options);
  const app = await loadSurfaceComponent(appOrId, { ...options, scope });
  const work = await resolveSurfaceComponentWork(app, scope, options.locale);
  await openSurfaceComponentSurface(app, {
    ...options,
    scope,
    context: workContext(work),
  });
}
