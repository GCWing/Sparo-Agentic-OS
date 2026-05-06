 
import { createContext, useContext, useEffect } from 'react';
import { workspaceManager, WorkspaceState, WorkspaceEvent } from '../services/business/workspaceManager';
import { WorkspaceInfo } from '../../shared/types';

export const getWorkspaceDisplayName = (workspace: WorkspaceInfo | null): string => {
  if (!workspace) {
    return '';
  }
  return workspace.name;
};

export interface WorkspaceContextValue extends WorkspaceState {
  lastUsedWorkspace: WorkspaceInfo | null;
  openedWorkspacesList: WorkspaceInfo[];
  normalWorkspacesList: WorkspaceInfo[];
  openWorkspace: (path: string) => Promise<WorkspaceInfo>;
  closeWorkspace: () => Promise<void>;
  closeWorkspaceById: (workspaceId: string) => Promise<void>;
  switchWorkspace: (workspace: WorkspaceInfo) => Promise<WorkspaceInfo>;
  rememberWorkspace: (workspaceId: string) => Promise<WorkspaceInfo>;
  reorderOpenedWorkspacesInSection: (
    section: 'projects',
    sourceWorkspaceId: string,
    targetWorkspaceId: string,
    position: 'before' | 'after'
  ) => Promise<void>;
  scanWorkspaceInfo: () => Promise<WorkspaceInfo | null>;
  refreshRecentWorkspaces: () => Promise<void>;
  removeWorkspaceFromRecent: (workspaceId: string) => Promise<void>;
  hasWorkspace: boolean;
  workspaceName: string;
  workspacePath: string;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export const useWorkspaceContext = (): WorkspaceContextValue => {
  const context = useContext(WorkspaceContext);

  if (!context) {
    throw new Error('useWorkspaceContext must be used within a WorkspaceProvider');
  }

  return context;
};

export const useLastUsedWorkspace = () => {
  const { lastUsedWorkspace, loading, error, hasWorkspace, workspaceName, workspacePath } = useWorkspaceContext();

  return {
    workspace: lastUsedWorkspace,
    loading,
    error,
    hasWorkspace,
    workspaceName,
    workspacePath,
  };
};

export const useWorkspaceEvents = (
  onWorkspaceOpened?: (workspace: WorkspaceInfo) => void,
  onWorkspaceClosed?: (workspaceId: string) => void,
  onWorkspaceRemembered?: (workspace: WorkspaceInfo) => void,
  onWorkspaceUpdated?: (workspace: WorkspaceInfo) => void
) => {
  useEffect(() => {
    const removeListener = workspaceManager.addEventListener((event: WorkspaceEvent) => {
      switch (event.type) {
        case 'workspace:opened':
          onWorkspaceOpened?.(event.workspace);
          break;
        case 'workspace:closed':
          onWorkspaceClosed?.(event.workspaceId);
          break;
        case 'workspace:remembered':
          onWorkspaceRemembered?.(event.workspace);
          break;
        case 'workspace:updated':
          onWorkspaceUpdated?.(event.workspace);
          break;
        case 'workspace:recent-updated':
          break;
      }
    });

    return removeListener;
  }, [onWorkspaceOpened, onWorkspaceClosed, onWorkspaceRemembered, onWorkspaceUpdated]);
};

export { WorkspaceContext };
