import { liveAppAPI } from '@/infrastructure/api/service-api/LiveAppAPI';
import type { LiveApp, LiveAppMeta } from '@/infrastructure/api/service-api/LiveAppAPI';
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
import type { LiveAppWorkbenchSessionMetadata, SessionMetadata } from '@/shared/types/session-history';
import {
  buildLiveAppWorkbenchMetadata,
  isCompositeLiveApp,
} from './liveAppInteraction';
import type { Session } from '@/flow_chat/types/flow-chat';

const log = createLogger('LiveAppWorkbenchService');

export interface OpenLiveAppOptions {
  entityId?: string | null;
  locale?: string | null;
  workspacePath?: string | null;
  theme?: string | null;
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

function normalizeWorkspaceIdentity(workspacePath?: string | null): string {
  const normalized = workspacePath?.trim().replace(/\\/g, '/').toLowerCase();
  return normalized || 'global';
}

function workbenchKey(
  metadata: Pick<LiveAppWorkbenchSessionMetadata, 'profile' | 'appId' | 'entityId' | 'workspacePath'>
): string {
  return [
    'live-app-workbench',
    metadata.profile,
    metadata.appId,
    metadata.entityId || 'default',
    normalizeWorkspaceIdentity(metadata.workspacePath),
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
    normalizeWorkspaceIdentity(binding.workspacePath) === normalizeWorkspaceIdentity(metadata.workspacePath)
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
      match.customMetadata?.liveAppWorkbench?.workspacePath ||
      metadata.workspacePath ||
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
  flowChatStore.setState(prev => {
    const session = prev.sessions.get(sessionId);
    if (!session) return prev;

    const nextSessions = new Map(prev.sessions);
    nextSessions.set(sessionId, {
      ...session,
      descriptor,
      title: metadata.interactionTitle || metadata.appName || session.title,
      workspacePath: metadata.workspacePath || session.workspacePath,
      config: {
        ...session.config,
        agentType: backendAgentType,
        workspacePath: metadata.workspacePath || session.config.workspacePath,
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
  return liveAppAPI.getLiveApp(
    appOrId,
    options.theme || undefined,
    options.workspacePath || undefined,
  );
}

export async function ensureLiveAppWorkbenchSession(
  app: LiveApp | LiveAppMeta,
  options: OpenLiveAppOptions = {}
): Promise<string> {
  validateCompositeInteraction(app);

  const metadata = buildLiveAppWorkbenchMetadata(app, {
    entityId: options.entityId,
    locale: options.locale,
    workspacePath: options.workspacePath,
  });
  const descriptor = liveAppWorkbenchDescriptor(metadata);
  const existingSessionId = await findExistingWorkbenchSessionId(metadata);
  if (existingSessionId) {
    updateSessionWorkbenchMetadata(existingSessionId, metadata);
    await flowChatManager.persistSessionMetadata(existingSessionId);
    await openWorkspaceSession(existingSessionId);
    return existingSessionId;
  }

  const title = metadata.interactionTitle || metadata.appName;
  const sessionId = await flowChatManager.createChatSession(
    {
      storageScope: 'agentic_os',
      workspacePath: options.workspacePath || undefined,
      sessionName: title,
      creationDeduplicationKey: workbenchKey(metadata),
      customMetadata: {
        liveAppWorkbench: metadata,
      },
    },
    descriptor,
  );

  updateSessionWorkbenchMetadata(sessionId, metadata);
  await flowChatManager.persistSessionMetadata(sessionId);
  await openWorkspaceSession(sessionId);
  return sessionId;
}

export async function openLiveApp(
  appOrId: LiveApp | LiveAppMeta | string,
  options: OpenLiveAppOptions = {}
): Promise<void> {
  const app = await loadLiveApp(appOrId, options);
  void liveAppAPI.recordRecentLiveApp(app.id)
    .catch(error => log.warn('Failed to persist recent Live App', { appId: app.id, error }));
  if (!isCompositeLiveApp(app)) {
    openWorkspaceScene(`live-app:${app.id}` as WorkspaceSceneId, {
      workspacePath: options.workspacePath,
    });
    return;
  }

  try {
    await ensureLiveAppWorkbenchSession(app, options);
  } catch (error) {
    log.error('Failed to open Live App workbench', { appId: app.id, error });
    notificationService.error(error instanceof Error ? error.message : String(error));
    throw error;
  }
}
