/**
 * Workspace ↔ session binding. Prefer `workspaceId` (`WorkspaceInfo.id`) when present.
 */

import type { WorkspaceInfo } from '@/shared/types';
import type { Session } from '../types/flow-chat';
import { sessionBelongsToWorkspaceNavRow } from './sessionOrdering';

type SessionScope = Pick<Session, 'workspaceId' | 'workspacePath'>;

type WorkspaceScope = Pick<WorkspaceInfo, 'id' | 'rootPath'>;

export function sessionMatchesWorkspace(session: SessionScope, workspace: WorkspaceScope): boolean {
  const sid = session.workspaceId?.trim();
  const wid = workspace.id?.trim();
  if (sid && wid && sid === wid) {
    return true;
  }
  return sessionBelongsToWorkspaceNavRow(session, workspace.rootPath);
}

export function findWorkspaceForSession(
  session: SessionScope,
  workspaces: Iterable<WorkspaceInfo>
): WorkspaceInfo | undefined {
  const sid = session.workspaceId?.trim();
  if (sid) {
    for (const w of workspaces) {
      if (w.id === sid) return w;
    }
  }
  for (const w of workspaces) {
    if (sessionMatchesWorkspace(session, w)) return w;
  }
  return undefined;
}
