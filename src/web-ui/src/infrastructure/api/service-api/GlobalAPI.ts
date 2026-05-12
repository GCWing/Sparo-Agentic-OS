 

import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';

export interface ApplicationState {
  status: AppStatus;
  workspace?: WorkspaceInfo;
  version: string;
  uptime: number;
}

export interface AppStatus {
  isInitialized: boolean;
  hasError: boolean;
  errorMessage?: string;
}

export interface WorkspaceIdentity {
  name?: string | null;
  creature?: string | null;
  vibe?: string | null;
  emoji?: string | null;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  rootPath: string;
  workspaceKind: string;
  openedAt: string;
  lastAccessed: string;
  identity?: WorkspaceIdentity | null;
}

export interface UpdateAppStatusRequest {
  status: AppStatus;
}

export interface OpenWorkspaceRequest {
  path: string;
}

export interface CloseWorkspaceRequest {
  workspaceId: string;
}

export interface RememberWorkspaceRequest {
  workspaceId: string;
}

export interface ReorderOpenedWorkspacesRequest {
  workspaceIds: string[];
}

export interface ScanWorkspaceInfoRequest {
  workspacePath: string;
}

export class GlobalAPI {
   
  async initializeGlobalState(): Promise<string> {
    try {
      return await api.invoke('initialize_global_state', { 
        request: {} 
      });
    } catch (error) {
      throw createTauriCommandError('initialize_global_state', error);
    }
  }

   
  async getAppState(): Promise<ApplicationState> {
    try {
      return await api.invoke('get_app_state', { 
        request: {} 
      });
    } catch (error) {
      throw createTauriCommandError('get_app_state', error);
    }
  }

   
  async updateAppStatus(status: AppStatus): Promise<void> {
    try {
      await api.invoke('update_app_status', { 
        request: { status } 
      });
    } catch (error) {
      throw createTauriCommandError('update_app_status', error, { status });
    }
  }

   
  async openWorkspace(path: string): Promise<WorkspaceInfo> {
    try {
      return await api.invoke('open_workspace', { 
        request: { path } 
      });
    } catch (error) {
      throw createTauriCommandError('open_workspace', error, { path });
    }
  }

  async closeWorkspace(workspaceId: string): Promise<void> {
    try {
      await api.invoke('close_workspace', { 
        request: { workspaceId } 
      });
    } catch (error) {
      throw createTauriCommandError('close_workspace', error, { workspaceId });
    }
  }

  async rememberWorkspace(workspaceId: string): Promise<WorkspaceInfo> {
    try {
      return await api.invoke('remember_workspace', {
        request: { workspaceId }
      });
    } catch (error) {
      throw createTauriCommandError('remember_workspace', error, { workspaceId });
    }
  }

  async reorderOpenedWorkspaces(workspaceIds: string[]): Promise<void> {
    try {
      await api.invoke('reorder_opened_workspaces', {
        request: { workspaceIds }
      });
    } catch (error) {
      throw createTauriCommandError('reorder_opened_workspaces', error, { workspaceIds });
    }
  }

   
  async getLastUsedWorkspace(): Promise<WorkspaceInfo | null> {
    try {
      return await api.invoke('get_last_used_workspace', { 
        request: {} 
      });
    } catch (error) {
      throw createTauriCommandError('get_last_used_workspace', error);
    }
  }

   
  async getRecentWorkspaces(): Promise<WorkspaceInfo[]> {
    try {
      return await api.invoke('get_recent_workspaces', { 
        request: {} 
      });
    } catch (error) {
      throw createTauriCommandError('get_recent_workspaces', error);
    }
  }

  async removeRecentWorkspace(workspaceId: string): Promise<void> {
    try {
      await api.invoke('remove_recent_workspace', {
        request: { workspaceId },
      });
    } catch (error) {
      throw createTauriCommandError('remove_recent_workspace', error, { workspaceId });
    }
  }

  async cleanupInvalidWorkspaces(): Promise<number> {
    try {
      return await api.invoke('cleanup_invalid_workspaces');
    } catch (error) {
      throw createTauriCommandError('cleanup_invalid_workspaces', error);
    }
  }

  async getOpenedWorkspaces(): Promise<WorkspaceInfo[]> {
    try {
      return await api.invoke('get_opened_workspaces', {
        request: {}
      });
    } catch (error) {
      throw createTauriCommandError('get_opened_workspaces', error);
    }
  }

   
  async scanWorkspaceInfo(workspacePath: string): Promise<WorkspaceInfo | null> {
    try {
      return await api.invoke('scan_workspace_info', { 
        request: { workspacePath } 
      });
    } catch (error) {
      throw createTauriCommandError('scan_workspace_info', error, { workspacePath });
    }
  }

   
  async getLastUsedWorkspacePath(): Promise<string | undefined> {
    try {
      const workspace = await this.getLastUsedWorkspace();
      return workspace?.rootPath;
    } catch (error) {
      throw createTauriCommandError('get_last_used_workspace', error);
    }
  }

}


export const globalAPI = new GlobalAPI();
