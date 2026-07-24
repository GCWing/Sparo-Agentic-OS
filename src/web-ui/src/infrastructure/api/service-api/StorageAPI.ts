import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';

export type ResetMode = 'soft' | 'app_data' | 'factory';

export interface StorageStatsCategory {
  id: string;
  label: string;
  path: string;
  sizeMb: number;
}

export interface StorageStats {
  totalSizeMb: number;
  appRootSizeMb: number;
  configSizeMb: number;
  dataSizeMb: number;
  stateSizeMb: number;
  sessionsSizeMb: number;
  worksSizeMb: number;
  runsSizeMb: number;
  appDataSizeMb: number;
  servicesSizeMb: number;
  workspacesSizeMb: number;
  agenticOsSizeMb: number;
  appsSizeMb: number;
  secretsSizeMb: number;
  cacheSizeMb: number;
  logsSizeMb: number;
  tempSizeMb: number;
  backupsSizeMb: number;
  categories: StorageStatsCategory[];
}

export interface ResetApplicationDataRequest {
  mode: ResetMode;
  confirmation: string;
  createBackup: boolean;
  includeLogs: boolean;
  includeSecrets: boolean;
  includeBrowserProfiles: boolean;
  includeProjectLocalSparoDirs: string[];
}

export interface ResetApplicationDataResult {
  resetId: string;
  deletedRoots: string[];
  preservedRoots: string[];
  backupDir?: string | null;
  bytesFreed: number;
  requiresRestart: boolean;
}

export class StorageAPI {
  async getStorageStatistics(): Promise<StorageStats> {
    try {
      return await api.invoke('get_storage_statistics', {});
    } catch (error) {
      throw createTauriCommandError('get_storage_statistics', error);
    }
  }

  async resetApplicationData(
    request: ResetApplicationDataRequest
  ): Promise<ResetApplicationDataResult> {
    try {
      return await api.invoke('reset_application_data', { request });
    } catch (error) {
      throw createTauriCommandError('reset_application_data', error, {
        mode: request.mode,
        createBackup: request.createBackup,
        includeLogs: request.includeLogs,
        includeSecrets: request.includeSecrets,
        includeBrowserProfiles: request.includeBrowserProfiles,
        includeProjectLocalSparoDirs: request.includeProjectLocalSparoDirs.length,
      });
    }
  }
}

export const storageAPI = new StorageAPI();
