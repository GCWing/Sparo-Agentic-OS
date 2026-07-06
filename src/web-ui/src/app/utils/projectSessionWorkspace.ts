import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import type { Session } from '@/flow_chat/types/flow-chat';
import { isSamePath } from '@/shared/utils/pathUtils';
import type { WorkspaceInfo } from '@/shared/types';
import { descriptorFromAgentType } from '@/flow_chat/domain/sessionDescriptor';
import { canHydrateSession } from '@/flow_chat/domain/sessionLoadPhase';
import {
  resolveSessionTypeDefinitionForDescriptor,
  type SessionDisplayMode,
} from '@/app/session-profiles';

type SessionDisplayBucket = SessionDisplayMode;

function sessionDisplayBucket(session: Session): SessionDisplayBucket {
  return resolveSessionTypeDefinitionForDescriptor(session.descriptor).lifecycle.displayMode;
}

function targetDisplayBucket(requestedMode: string | undefined): SessionDisplayBucket {
  const descriptor = descriptorFromAgentType(requestedMode);
  return resolveSessionTypeDefinitionForDescriptor(descriptor).lifecycle.displayMode;
}

function sessionBelongsToWorkspace(session: Session, workspace: WorkspaceInfo): boolean {
  const wid = session.workspaceId?.trim();
  if (wid && workspace.id && wid === workspace.id) {
    return true;
  }
  const path = session.workspacePath?.trim();
  const root = workspace.rootPath?.trim();
  if (!path || !root) {
    return false;
  }
  return isSamePath(path, root);
}

function isEmptyReusableSession(session: Session, workspace: WorkspaceInfo, bucket: SessionDisplayBucket): boolean {
  if (session.sessionKind !== 'normal') {
    return false;
  }
  if (canHydrateSession(session)) {
    return false;
  }
  if (session.dialogTurns.length > 0) {
    return false;
  }
  if (!sessionBelongsToWorkspace(session, workspace)) {
    return false;
  }
  return sessionDisplayBucket(session) === bucket;
}

/**
 * If the workspace already has a main session with no dialog turns for the same UI mode
 * (Runno / BitFun Coder / Cowork / Design / App Builder), return its id so callers can switch instead of creating another.
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
 * Reuses an in-memory empty App Builder session (any storage), or global agentic_os empty ones.
 * Product App data lives under the app data dir; the chat session is not tied to a user-picked project path.
 */
export function findReusableEmptyAppBuilderSessionId(): string | null {
  const sessions = flowChatStore.getState().sessions;
  let best: { id: string; lastActiveAt: number } | null = null;
  for (const session of sessions.values()) {
    if (session.sessionKind !== 'normal') {
      continue;
    }
    if (canHydrateSession(session)) {
      continue;
    }
    if (session.dialogTurns.length > 0) {
      continue;
    }
    if (sessionDisplayBucket(session) !== 'app-builder') {
      continue;
    }
    if (!best || session.lastActiveAt > best.lastActiveAt) {
      best = { id: session.sessionId, lastActiveAt: session.lastActiveAt };
    }
  }
  return best?.id ?? null;
}

/**
 * Workspace-scoped task sessions belong to project workspaces.
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
  };
}
