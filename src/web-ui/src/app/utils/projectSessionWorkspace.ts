import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import type { Session } from '@/flow_chat/types/flow-chat';
import { isRemoteWorkspace, type WorkspaceInfo } from '@/shared/types';

type SessionDisplayBucket = 'code' | 'cowork' | 'design' | 'liveappstudio';

function normalizeAgentModeForWorkspace(mode: string | undefined): string {
  return mode || 'agentic';
}

function sessionDisplayBucket(sessionMode: string | undefined): SessionDisplayBucket {
  if (!sessionMode) {
    return 'code';
  }
  const normalized = sessionMode.toLowerCase();
  if (normalized === 'cowork') {
    return 'cowork';
  }
  if (normalized === 'design') {
    return 'design';
  }
  if (normalized === 'liveappstudio') {
    return 'liveappstudio';
  }
  return 'code';
}

function targetDisplayBucket(requestedMode: string | undefined): SessionDisplayBucket {
  const agentMode = normalizeAgentModeForWorkspace(requestedMode);
  return sessionDisplayBucket(agentMode);
}

function sessionBelongsToWorkspace(session: Session, workspace: WorkspaceInfo): boolean {
  const path = session.workspacePath?.trim();
  const root = workspace.rootPath?.trim();
  if (!path || !root || path !== root) {
    return false;
  }
  if (isRemoteWorkspace(workspace)) {
    const wc = workspace.connectionId?.trim() ?? '';
    const sc = session.remoteConnectionId?.trim() ?? '';
    if (wc.length > 0 || sc.length > 0) {
      return wc === sc;
    }
  }
  return true;
}

function isEmptyReusableSession(session: Session, workspace: WorkspaceInfo, bucket: SessionDisplayBucket): boolean {
  if (session.sessionKind !== 'normal') {
    return false;
  }
  if (session.isHistorical) {
    return false;
  }
  if (session.dialogTurns.length > 0) {
    return false;
  }
  if (!sessionBelongsToWorkspace(session, workspace)) {
    return false;
  }
  return sessionDisplayBucket(session.mode) === bucket;
}

/**
 * If the workspace already has a main session with no dialog turns for the same UI mode
 * (Code / Cowork / Design / LiveAppStudio), return its id so callers can switch instead of creating another.
 */
export function findReusableEmptySessionId(
  workspace: WorkspaceInfo,
  requestedMode?: string
): string | null {
  const bucket = targetDisplayBucket(requestedMode);
  const sessions = flowChatStore.getState().sessions;
  let best: { id: string; lastActiveAt: number } | null = null;
  for (const session of sessions.values()) {
    if (!isEmptyReusableSession(session, workspace, bucket)) {
      continue;
    }
    if (!best || session.lastActiveAt > best.lastActiveAt) {
      best = { id: session.sessionId, lastActiveAt: session.lastActiveAt };
    }
  }
  return best?.id ?? null;
}

/**
 * Reuses an in-memory empty Live App Studio session (any storage), or global agentic_os empty ones.
 * Live App data lives under the app data dir; the chat session is not tied to a user-picked project path.
 */
export function findReusableEmptyLiveAppStudioSessionId(): string | null {
  const sessions = flowChatStore.getState().sessions;
  let best: { id: string; lastActiveAt: number } | null = null;
  for (const session of sessions.values()) {
    if (session.sessionKind !== 'normal') {
      continue;
    }
    if (session.isHistorical) {
      continue;
    }
    if (session.dialogTurns.length > 0) {
      continue;
    }
    if (session.mode?.toLowerCase() !== 'liveappstudio') {
      continue;
    }
    if (!best || session.lastActiveAt > best.lastActiveAt) {
      best = { id: session.sessionId, lastActiveAt: session.lastActiveAt };
    }
  }
  return best?.id ?? null;
}

/**
 * Code / Cowork / Design sessions belong to project workspaces.
 */
export function pickWorkspaceForProjectChatSession(
  lastUsedWorkspace: WorkspaceInfo | null | undefined,
  normalWorkspacesList: WorkspaceInfo[]
): WorkspaceInfo | null {
  if (lastUsedWorkspace) {
    return lastUsedWorkspace;
  }
  return normalWorkspacesList[0] ?? null;
}

export function flowChatSessionConfigForWorkspace(workspace: WorkspaceInfo) {
  return {
    workspacePath: workspace.rootPath,
    ...(isRemoteWorkspace(workspace) && workspace.connectionId
      ? { remoteConnectionId: workspace.connectionId }
      : {}),
  };
}
