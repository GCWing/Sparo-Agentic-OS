/**
 * workspaceFilters.ts — helpers to hide internal system workspaces from user-facing lists.
 *
 * The runtime data directory (~/.sparo_os) contains internal paths like
 * ~/.sparo_os/core/agentic_os that are used by the platform itself and
 * should never appear as user workspaces in the Task Center.
 */

import type { WorkspaceInfo } from '@/shared/types';

/**
 * Returns true if the workspace root path is inside the Sparo OS
 * runtime/config directory and should be hidden from user-facing lists.
 */
export function isInternalWorkspace(workspace: WorkspaceInfo): boolean {
  const path = workspace.rootPath?.trim() ?? '';
  if (!path) return false;

  // Normalize separators for cross-platform matching
  const normalized = path.replace(/\\/g, '/');

  // Hide anything whose root IS or is INSIDE ~/.sparo_os (runtime data dir)
  // Matches both:
  //   C:/Users/xxx/.sparo_os/core/agentic_os  (nested)
  //   C:/Users/xxx/.sparo_os                  (root itself)
  if (/(^|\/)\.sparo_os(\/|$)/.test(normalized)) return true;

  // Also catch Windows %APPDATA%\sparo_os\core paths (no leading dot)
  if (normalized.includes('/sparo_os/core/')) return true;

  return false;
}

/**
 * Filters out internal system workspaces from a list.
 */
export function filterUserWorkspaces(workspaces: WorkspaceInfo[]): WorkspaceInfo[] {
  return workspaces.filter((ws) => !isInternalWorkspace(ws));
}
