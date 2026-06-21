import type { WorkspaceSceneId } from './workspaceSceneTypes';
import { useWorkspaceSurfaceStore } from './workspaceSurfaceStore';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import { flowChatManager } from '@/flow_chat/services/FlowChatManager';
import { syncSessionToModernStore } from '@/flow_chat/services/storeSync';
import {
  getAgenticOsSessionDescriptor,
  isSystemAgenticOsSession,
} from '@/flow_chat/domain/sessionDescriptor';
import type { WorkspaceSurfaceContext } from './workspaceSurfaceTypes';

function isAgenticOsSession(sessionId: string): boolean {
  const session = flowChatStore.getState().sessions.get(sessionId);
  return !!session && isSystemAgenticOsSession(session.descriptor);
}

function findLatestAgenticOsSessionId(): string | null {
  return Array.from(flowChatStore.getState().sessions.values())
    .filter((session) => isSystemAgenticOsSession(session.descriptor))
    .sort(
      (a, b) =>
        (b.lastActiveAt ?? b.createdAt ?? 0) - (a.lastActiveAt ?? a.createdAt ?? 0)
    )[0]?.sessionId ?? null;
}

export interface OpenWorkspaceSceneOptions {
  workspacePath?: string | null;
  context?: WorkspaceSurfaceContext | null;
}

export interface OpenWorkspaceSessionOptions {
  context?: WorkspaceSurfaceContext | null;
}

export function openWorkspaceScene(
  sceneId: WorkspaceSceneId,
  options: OpenWorkspaceSceneOptions = {}
): void {
  useWorkspaceSurfaceStore.getState().openSurface({
    kind: 'scene',
    sceneId,
    workspacePath: options.workspacePath,
  }, {
    context: options.context,
  });
}

export async function openWorkspaceSession(
  sessionId: string,
  options: OpenWorkspaceSessionOptions = {}
): Promise<void> {
  if (useWorkspaceSurfaceStore.getState().focusedSessionId === sessionId) {
    syncSessionToModernStore(sessionId);
  } else {
    await flowChatManager.switchChatSession(sessionId);
    syncSessionToModernStore(sessionId);
  }

  if (isAgenticOsSession(sessionId)) {
    useWorkspaceSurfaceStore.getState().openSurface({
      kind: 'agentic-os-home',
      agenticOsSessionId: sessionId,
    }, {
      context: options.context,
    });
    return;
  }

  useWorkspaceSurfaceStore.getState().openSurface(
    { kind: 'session', sessionId },
    { context: options.context }
  );
}

export async function openWorkspaceHome(): Promise<string> {
  const agenticOsSessionId = findLatestAgenticOsSessionId();
  if (agenticOsSessionId) {
    await openWorkspaceSession(agenticOsSessionId);
    return agenticOsSessionId;
  }

  const newSessionId = await flowChatManager.createChatSession(
    { storageScope: 'agentic_os' },
    getAgenticOsSessionDescriptor()
  );
  useWorkspaceSurfaceStore.getState().openSurface({
    kind: 'agentic-os-home',
    agenticOsSessionId: newSessionId,
  });
  return newSessionId;
}

export function getActiveWorkspaceSurface() {
  return useWorkspaceSurfaceStore.getState().activeSurface;
}
