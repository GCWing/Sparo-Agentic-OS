import type { WorkspaceSceneId } from './workspaceSceneTypes';
import { useWorkspaceSurfaceStore } from './workspaceSurfaceStore';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import { flowChatManager } from '@/flow_chat/services/FlowChatManager';
import { syncSessionToModernStore } from '@/flow_chat/services/storeSync';
import {
  getDispatcherSessionDescriptor,
  isSystemAgenticOsSession,
} from '@/flow_chat/domain/sessionDescriptor';

function isDispatcherSession(sessionId: string): boolean {
  const session = flowChatStore.getState().sessions.get(sessionId);
  return !!session && isSystemAgenticOsSession(session.descriptor);
}

function findLatestDispatcherSessionId(): string | null {
  return Array.from(flowChatStore.getState().sessions.values())
    .filter((session) => isSystemAgenticOsSession(session.descriptor))
    .sort(
      (a, b) =>
        (b.lastActiveAt ?? b.createdAt ?? 0) - (a.lastActiveAt ?? a.createdAt ?? 0)
    )[0]?.sessionId ?? null;
}

export interface OpenWorkspaceSceneOptions {
  workspacePath?: string | null;
}

export function openWorkspaceScene(
  sceneId: WorkspaceSceneId,
  options: OpenWorkspaceSceneOptions = {}
): void {
  useWorkspaceSurfaceStore.getState().openSurface({
    kind: 'scene',
    sceneId,
    workspacePath: options.workspacePath,
  });
}

export async function openWorkspaceSession(sessionId: string): Promise<void> {
  if (flowChatStore.getState().activeSessionId === sessionId) {
    syncSessionToModernStore(sessionId);
  } else {
    await flowChatManager.switchChatSession(sessionId);
    syncSessionToModernStore(sessionId);
  }

  if (isDispatcherSession(sessionId)) {
    useWorkspaceSurfaceStore.getState().openSurface({
      kind: 'dispatcher-home',
      dispatcherSessionId: sessionId,
    });
    return;
  }

  useWorkspaceSurfaceStore.getState().openSurface({ kind: 'session', sessionId });
}

export async function openWorkspaceHome(): Promise<string> {
  const dispatcherSessionId = findLatestDispatcherSessionId();
  if (dispatcherSessionId) {
    await openWorkspaceSession(dispatcherSessionId);
    return dispatcherSessionId;
  }

  const newSessionId = await flowChatManager.createChatSession(
    { storageScope: 'agentic_os' },
    getDispatcherSessionDescriptor()
  );
  useWorkspaceSurfaceStore.getState().openSurface({
    kind: 'dispatcher-home',
    dispatcherSessionId: newSessionId,
  });
  return newSessionId;
}

export function getActiveWorkspaceSurface() {
  return useWorkspaceSurfaceStore.getState().activeSurface;
}
