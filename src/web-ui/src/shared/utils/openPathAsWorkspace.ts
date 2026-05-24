import { workspaceManager } from '@/infrastructure/services/business/workspaceManager';
import type { WorkspaceInfo } from '@/shared/types';
import { pathsEquivalentFs } from './pathUtils';

export async function openPathAsWorkspace(path: string): Promise<WorkspaceInfo> {
  const targetPath = path.trim();
  if (!targetPath) {
    throw new Error('Workspace path is required');
  }

  const state = workspaceManager.getState();
  const openedWorkspace = Array.from(state.openedWorkspaces.values()).find((workspace) =>
    pathsEquivalentFs(workspace.rootPath, targetPath)
  );

  if (openedWorkspace) {
    return workspaceManager.switchWorkspace(openedWorkspace);
  }

  return workspaceManager.openWorkspace(targetPath);
}
