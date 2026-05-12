import type { WorkspaceInfo } from '@/shared/types';

export type RecentWorkspaceLineParts = {
  hostPrefix: string | null;
  folderLabel: string;
  tooltip: string;
};

export function getRecentWorkspaceLineParts(workspace: WorkspaceInfo): RecentWorkspaceLineParts {
  return {
    hostPrefix: null,
    folderLabel: workspace.name,
    tooltip: workspace.rootPath,
  };
}
