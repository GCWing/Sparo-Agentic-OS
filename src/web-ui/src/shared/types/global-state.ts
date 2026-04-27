/**
 * Global state and app-level API types.
 */
import { globalAPI } from '@/infrastructure/api';
import { workspaceAPI } from '@/infrastructure/api';
import type {
  ApplicationState as APIApplicationState,
  AppStatus as APIAppStatus,
  WorkspaceInfo as APIWorkspaceInfo,
} from '@/infrastructure/api/service-api/GlobalAPI';
import { createLogger } from '../utils/logger';

const logger = createLogger('GlobalStateAPI');


export enum AppStatus {
  Initializing = 'initializing',
  Running = 'running',
  Processing = 'processing',
  Idle = 'idle',
  Error = 'error',
}


export interface UserSettings {
  theme: string;
  language: string;
  autoSaveInterval: number;
  maxCachedGraphs: number;
  debugMode: boolean;
  customSettings: Record<string, any>;
}


export interface ApplicationState {
  appId: string;
  startupTime: string;
  version: string;
  userSettings: UserSettings;
  status: AppStatus;
  lastActivity: string;
}

export enum WorkspaceKind {
  Normal = 'normal',
  Assistant = 'assistant',
  Remote = 'remote',
}

export interface WorkspaceIdentity {
  name?: string;
  creature?: string;
  vibe?: string;
  emoji?: string;
  modelPrimary?: string;
  modelFast?: string;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  rootPath: string;
  workspaceKind: WorkspaceKind;
  assistantId?: string | null;
  openedAt: string;
  lastAccessed: string;
  identity?: WorkspaceIdentity | null;
  connectionId?: string;
  connectionName?: string;
  /**
   * Logical workspace host for stable scoping: `{sshHost}:{rootPath}`.
   * Local / assistant workspaces use `localhost` (from backend); remote uses SSH config host.
   */
  sshHost?: string;
}

export function isRemoteWorkspace(workspace: WorkspaceInfo | null | undefined): boolean {
  return workspace?.workspaceKind === WorkspaceKind.Remote;
}


export enum WorkspaceAction {
  Opened = 'opened',
  Closed = 'closed',
  Switched = 'switched',
  Scanned = 'scanned',
  GraphBuilt = 'graphBuilt',
}


export interface WorkspaceHistoryEntry {
  workspaceId: string;
  action: WorkspaceAction;
  timestamp: string;
  description?: string;
}


export enum GraphStatus {
  Building = 'building',
  Ready = 'ready',
  Stale = 'stale',
  Error = 'error',
}


export enum CacheStrategy {
  LRU = 'lru',
  LFU = 'lfu',
  FIFO = 'fifo',
}


export interface CacheStatistics {
  totalCachedGraphs: number;
  cacheHitRate: number;
  totalMemoryUsage: number;
  oldestCacheAge?: string;
}

 
export interface GlobalStateAPI {
  
  initializeGlobalState(): Promise<string>;
  
  
  getAppState(): Promise<ApplicationState>;
  updateAppStatus(status: AppStatus): Promise<void>;

  
  openWorkspace(path: string): Promise<WorkspaceInfo>;
  openRemoteWorkspace(
    remotePath: string,
    connectionId: string,
    connectionName: string,
    sshHost?: string
  ): Promise<WorkspaceInfo>;
  createAssistantWorkspace(): Promise<WorkspaceInfo>;
  deleteAssistantWorkspace(workspaceId: string): Promise<void>;
  resetAssistantWorkspace(workspaceId: string): Promise<WorkspaceInfo>;
  closeWorkspace(workspaceId: string): Promise<void>;
  setActiveWorkspace(workspaceId: string): Promise<WorkspaceInfo>;
  reorderOpenedWorkspaces(workspaceIds: string[]): Promise<void>;
  getCurrentWorkspace(): Promise<WorkspaceInfo | null>;
  getOpenedWorkspaces(): Promise<WorkspaceInfo[]>;
  getRecentWorkspaces(): Promise<WorkspaceInfo[]>;
  removeWorkspaceFromRecent(workspaceId: string): Promise<void>;
  cleanupInvalidWorkspaces(): Promise<number>;
  scanWorkspaceInfo(workspacePath: string): Promise<WorkspaceInfo | null>;
  
  
  startFileWatch(path: string, recursive?: boolean): Promise<void>;
  stopFileWatch(path: string): Promise<void>;
  getWatchedPaths(): Promise<string[]>;
}

function mapAppStatusToApi(status: AppStatus): APIAppStatus {
  switch (status) {
    case AppStatus.Initializing:
      return { isInitialized: false, hasError: false };
    case AppStatus.Error:
      return { isInitialized: true, hasError: true, errorMessage: 'Application error' };
    default:
      return { isInitialized: true, hasError: false };
  }
}

function mapApiStatus(status: APIAppStatus): AppStatus {
  if (status.hasError) return AppStatus.Error;
  if (!status.isInitialized) return AppStatus.Initializing;
  return AppStatus.Running;
}

function createDefaultUserSettings(): UserSettings {
  return {
    theme: 'system',
    language: 'en-US',
    autoSaveInterval: 0,
    maxCachedGraphs: 0,
    debugMode: false,
    customSettings: {},
  };
}

function mapWorkspaceKind(workspaceKind: APIWorkspaceInfo['workspaceKind']): WorkspaceKind {
  switch (workspaceKind) {
    case WorkspaceKind.Assistant:
      return WorkspaceKind.Assistant;
    case WorkspaceKind.Remote:
      return WorkspaceKind.Remote;
    default:
      return WorkspaceKind.Normal;
  }
}

function mapWorkspaceIdentity(
  identity: APIWorkspaceInfo['identity']
): WorkspaceIdentity | null | undefined {
  if (!identity) {
    return identity;
  }

  return {
    name: identity.name ?? undefined,
    creature: identity.creature ?? undefined,
    vibe: identity.vibe ?? undefined,
    emoji: identity.emoji ?? undefined,
  };
}

function mapWorkspaceInfo(workspace: APIWorkspaceInfo): WorkspaceInfo {
  return {
    id: workspace.id,
    name: workspace.name,
    rootPath: workspace.rootPath,
    workspaceKind: mapWorkspaceKind(workspace.workspaceKind),
    assistantId: workspace.assistantId ?? undefined,
    openedAt: workspace.openedAt,
    lastAccessed: workspace.lastAccessed,
    identity: mapWorkspaceIdentity(workspace.identity),
    connectionId: workspace.connectionId,
    connectionName: workspace.connectionName,
    sshHost:
      workspace.sshHost ??
      (workspace.workspaceKind?.toLowerCase() !== 'remote' ? 'localhost' : undefined),
  };
}

function mapApplicationState(state: APIApplicationState): ApplicationState {
  const now = new Date().toISOString();
  return {
    appId: 'bitfun',
    startupTime: new Date(Date.now() - state.uptime).toISOString(),
    version: state.version,
    userSettings: createDefaultUserSettings(),
    status: mapApiStatus(state.status),
    lastActivity: now,
  };
}

 
export function createGlobalStateAPI(): GlobalStateAPI {
  return {
    
    async initializeGlobalState(): Promise<string> {
      return await globalAPI.initializeGlobalState();
    },

    
    async getAppState(): Promise<ApplicationState> {
      return mapApplicationState(await globalAPI.getAppState());
    },

    async updateAppStatus(status: AppStatus): Promise<void> {
      return await globalAPI.updateAppStatus(mapAppStatusToApi(status));
    },

    
    async openWorkspace(path: string): Promise<WorkspaceInfo> {
      logger.debug('openWorkspace called with', {
        path,
        pathType: typeof path,
        pathLength: path?.length,
        isEmpty: !path || path.trim() === ''
      });
      
      if (!path || path.trim() === '') {
        throw new Error('Path parameter is required and cannot be empty');
      }
      
      return mapWorkspaceInfo(await globalAPI.openWorkspace(path));
    },

    async openRemoteWorkspace(
      remotePath: string,
      connectionId: string,
      connectionName: string,
      sshHost?: string
    ): Promise<WorkspaceInfo> {
      return mapWorkspaceInfo(
        await globalAPI.openRemoteWorkspace(remotePath, connectionId, connectionName, sshHost)
      );
    },

    async createAssistantWorkspace(): Promise<WorkspaceInfo> {
      return mapWorkspaceInfo(await globalAPI.createAssistantWorkspace());
    },

    async deleteAssistantWorkspace(workspaceId: string): Promise<void> {
      return await globalAPI.deleteAssistantWorkspace(workspaceId);
    },

    async resetAssistantWorkspace(workspaceId: string): Promise<WorkspaceInfo> {
      return mapWorkspaceInfo(await globalAPI.resetAssistantWorkspace(workspaceId));
    },

    async closeWorkspace(workspaceId: string): Promise<void> {
      return await globalAPI.closeWorkspace(workspaceId);
    },

    async setActiveWorkspace(workspaceId: string): Promise<WorkspaceInfo> {
      return mapWorkspaceInfo(await globalAPI.setActiveWorkspace(workspaceId));
    },

    async reorderOpenedWorkspaces(workspaceIds: string[]): Promise<void> {
      return await globalAPI.reorderOpenedWorkspaces(workspaceIds);
    },

    async getCurrentWorkspace(): Promise<WorkspaceInfo | null> {
      const workspace = await globalAPI.getCurrentWorkspace();
      return workspace ? mapWorkspaceInfo(workspace) : null;
    },

    async getOpenedWorkspaces(): Promise<WorkspaceInfo[]> {
      return (await globalAPI.getOpenedWorkspaces()).map(mapWorkspaceInfo);
    },

    async getRecentWorkspaces(): Promise<WorkspaceInfo[]> {
      const workspaces = (await globalAPI.getRecentWorkspaces()).map(mapWorkspaceInfo);
      logger.debug('getRecentWorkspaces returned', workspaces);
      return workspaces;
    },

    async removeWorkspaceFromRecent(workspaceId: string): Promise<void> {
      await globalAPI.removeRecentWorkspace(workspaceId);
    },

    async cleanupInvalidWorkspaces(): Promise<number> {
      return await globalAPI.cleanupInvalidWorkspaces();
    },

    async scanWorkspaceInfo(workspacePath: string): Promise<WorkspaceInfo | null> {
      const workspace = await globalAPI.scanWorkspaceInfo(workspacePath);
      return workspace ? mapWorkspaceInfo(workspace) : null;
    },

    
    async startFileWatch(path: string, recursive?: boolean): Promise<void> {
      return await workspaceAPI.startFileWatch(path, recursive);
    },

    async stopFileWatch(path: string): Promise<void> {
      return await workspaceAPI.stopFileWatch(path);
    },

    async getWatchedPaths(): Promise<string[]> {
      return await workspaceAPI.getWatchedPaths();
    },
  };
}


export const globalStateAPI = createGlobalStateAPI();
