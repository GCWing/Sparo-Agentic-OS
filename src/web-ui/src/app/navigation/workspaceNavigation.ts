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
import type { WorkspaceSurfaceHistoryMode } from './workspaceSurfaceStore';
import type { AppScope } from '@/shared/types/app-scope';
import {
  projectRuntimeScopeFromWorkspacePath,
  runtimeScopeFromAppScope,
  systemRuntimeScope,
  type RuntimeScope,
} from '@/shared/types/runtime-scope';

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
  scope?: RuntimeScope | null;
  workspacePath?: string | null;
  appScope?: AppScope | null;
  context?: WorkspaceSurfaceContext | null;
  historyMode?: WorkspaceSurfaceHistoryMode;
}

export interface OpenWorkspaceSessionOptions {
  context?: WorkspaceSurfaceContext | null;
}

function resolveSceneScope(options: OpenWorkspaceSceneOptions): RuntimeScope {
  if (options.scope) {
    return options.scope;
  }
  if (options.appScope) {
    return runtimeScopeFromAppScope(options.appScope);
  }
  if (options.workspacePath === null) {
    return systemRuntimeScope();
  }
  return projectRuntimeScopeFromWorkspacePath(options.workspacePath) ?? systemRuntimeScope();
}

export function openWorkspaceScene(
  sceneId: WorkspaceSceneId,
  options: OpenWorkspaceSceneOptions = {}
): void {
  useWorkspaceSurfaceStore.getState().openSurface({
    kind: 'scene',
    sceneId,
    scope: resolveSceneScope(options),
    appScope: options.appScope,
  }, {
    context: options.context,
    historyMode: options.historyMode,
  });
}

export function goBackWorkspaceScene(): boolean {
  return useWorkspaceSurfaceStore.getState().goBackScene();
}

export function openWorkspaceSceneHistoryEntry(index: number): boolean {
  return useWorkspaceSurfaceStore.getState().openSceneHistoryEntry(index);
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
      scope: systemRuntimeScope(),
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
    scope: systemRuntimeScope(),
  });
  return newSessionId;
}

export function getActiveWorkspaceSurface() {
  return useWorkspaceSurfaceStore.getState().activeSurface;
}
