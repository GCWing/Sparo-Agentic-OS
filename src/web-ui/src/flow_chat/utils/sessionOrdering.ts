import type { Session } from '../types/flow-chat';
import type { WorkspaceInfo } from '@/shared/types';
import { isSamePath, normalizeRemoteWorkspacePath } from '@/shared/utils/pathUtils';

/**
 * Prefer stable `workspaceId` when matching opened workspaces (path strings can differ slightly).
 */
export function resolveWorkspaceForSession(
  session: Pick<Session, 'workspaceId' | 'workspacePath'> | undefined,
  openedWorkspaces: WorkspaceInfo[]
): WorkspaceInfo | undefined {
  if (!session) return undefined;
  const wid = session.workspaceId?.trim();
  if (wid) {
    const byId = openedWorkspaces.find(w => w.id === wid);
    if (byId) return byId;
  }
  return findOpenedWorkspaceForSession(session, openedWorkspaces);
}

/**
 * Short folder label when `WorkspaceInfo` is not available. If a saved path ends with a generic
 * `workspace` folder name, prefer the parent folder so the label remains meaningful.
 */
export function fallbackWorkspaceFolderLabel(workspacePath: string): string {
  const norm = workspacePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = norm.split('/').filter(Boolean);
  if (parts.length === 0) return '';
  const last = parts[parts.length - 1];
  if (last.toLowerCase() === 'workspace' && parts.length >= 2) {
    return parts[parts.length - 2] || last;
  }
  return last;
}

/**
 * Whether a persisted session belongs to a nav row for this workspace (path-aligned).
 */
export function sessionBelongsToWorkspaceNavRow(
  session: Pick<Session, 'workspacePath'>,
  workspacePath: string
): boolean {
  const sessionRoot = session.workspacePath || workspacePath;
  return (
    isSamePath(sessionRoot, workspacePath) ||
    normalizeRemoteWorkspacePath(sessionRoot) === normalizeRemoteWorkspacePath(workspacePath)
  );
}

/**
 * Resolves which opened workspace owns a session (for unified nav list + workspace activation on switch).
 */
export function findOpenedWorkspaceForSession(
  session: Pick<Session, 'workspacePath'> | undefined,
  openedWorkspaces: WorkspaceInfo[]
): WorkspaceInfo | undefined {
  if (!session) return undefined;
  for (const ws of openedWorkspaces) {
    if (sessionBelongsToWorkspaceNavRow(session, ws.rootPath)) {
      return ws;
    }
  }
  return undefined;
}

export function getSessionSortTimestamp(session: Pick<Session, 'createdAt' | 'lastFinishedAt'>): number {
  return session.lastFinishedAt ?? session.createdAt;
}

export function compareSessionsForDisplay(
  a: Pick<Session, 'sessionId' | 'createdAt' | 'lastFinishedAt'>,
  b: Pick<Session, 'sessionId' | 'createdAt' | 'lastFinishedAt'>
): number {
  const timestampDiff = getSessionSortTimestamp(b) - getSessionSortTimestamp(a);
  if (timestampDiff !== 0) {
    return timestampDiff;
  }

  const createdAtDiff = b.createdAt - a.createdAt;
  if (createdAtDiff !== 0) {
    return createdAtDiff;
  }

  return a.sessionId.localeCompare(b.sessionId);
}
