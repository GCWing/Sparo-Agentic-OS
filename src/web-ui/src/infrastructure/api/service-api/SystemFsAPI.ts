import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';

export type DriveKind = 'fixed' | 'removable' | 'network' | 'optical' | 'unknown';
export type FsEntryKind = 'file' | 'dir' | 'symlink' | 'other';
export type FilesContextScope = 'workspace' | 'system' | 'pinned';
export type SystemFsScope =
  | { kind: 'workspace'; root: string }
  | { kind: 'system'; allowed: 'auto' | 'prompt' | 'denied' }
  | { kind: 'pinned'; pinId: string };

export interface DriveInfo {
  id: string;
  mount: string;
  label: string;
  fsType: string;
  totalBytes: number;
  freeBytes: number;
  kind: DriveKind;
}

export interface QuickFolder {
  id: string;
  name: string;
  path: string;
  icon: string;
}

export interface FsEntry {
  path: string;
  name: string;
  kind: FsEntryKind;
  size: number;
  modified?: string;
  readonly: boolean;
  hidden: boolean;
}

export interface OperationResult {
  success: boolean;
  error?: string;
  before?: string;
  after?: string;
}

export interface PinnedPath {
  id: string;
  path: string;
  label?: string;
  kind: 'file' | 'dir';
  addedAt: string;
}

export interface PinnedPathsState {
  paths: PinnedPath[];
  grantedRoots: string[];
}

export interface FilesContextSelection {
  path: string;
  kind: 'file' | 'dir';
  size?: number;
}

export interface FilesContext {
  scope: FilesContextScope;
  cwd: string;
  workspaceRoot?: string;
  selection: FilesContextSelection[];
  recentlyOpenedPaths?: string[];
}

class SystemFsAPI {
  async listDrives(): Promise<DriveInfo[]> {
    try {
      return await api.invoke('system_fs_list_drives');
    } catch (error) {
      throw createTauriCommandError('system_fs_list_drives', error);
    }
  }

  async listQuickFolders(): Promise<QuickFolder[]> {
    try {
      return await api.invoke('system_fs_list_quick_folders');
    } catch (error) {
      throw createTauriCommandError('system_fs_list_quick_folders', error);
    }
  }

  async listDir(path: string): Promise<FsEntry[]> {
    try {
      return await api.invoke('system_fs_list_dir', { request: { path } });
    } catch (error) {
      throw createTauriCommandError('system_fs_list_dir', error, { path });
    }
  }

  async stat(path: string): Promise<FsEntry> {
    try {
      return await api.invoke('system_fs_stat', { request: { path } });
    } catch (error) {
      throw createTauriCommandError('system_fs_stat', error, { path });
    }
  }

  async createFile(path: string, scope: SystemFsScope = { kind: 'system', allowed: 'auto' }): Promise<OperationResult> {
    try {
      return await api.invoke('system_fs_create_file', { request: { path, scope } });
    } catch (error) {
      throw createTauriCommandError('system_fs_create_file', error, { path });
    }
  }

  async createDir(path: string, scope: SystemFsScope = { kind: 'system', allowed: 'auto' }): Promise<OperationResult> {
    try {
      return await api.invoke('system_fs_create_dir', { request: { path, scope } });
    } catch (error) {
      throw createTauriCommandError('system_fs_create_dir', error, { path });
    }
  }

  async rename(
    oldPath: string,
    newPath: string,
    scope: SystemFsScope = { kind: 'system', allowed: 'auto' }
  ): Promise<OperationResult> {
    try {
      return await api.invoke('system_fs_rename', {
        request: { oldPath, newPath, scope },
      });
    } catch (error) {
      throw createTauriCommandError('system_fs_rename', error, { oldPath, newPath });
    }
  }

  async delete(
    path: string,
    recursive = true,
    scope: SystemFsScope = { kind: 'system', allowed: 'auto' }
  ): Promise<OperationResult> {
    try {
      return await api.invoke('system_fs_delete', {
        request: { path, recursive, scope },
      });
    } catch (error) {
      throw createTauriCommandError('system_fs_delete', error, { path, recursive });
    }
  }

  async revealInOs(path: string): Promise<void> {
    try {
      await api.invoke('system_fs_reveal_in_os', { request: { path } });
    } catch (error) {
      throw createTauriCommandError('system_fs_reveal_in_os', error, { path });
    }
  }

  async openWithDefault(path: string): Promise<void> {
    try {
      await api.invoke('system_fs_open_with_default', { request: { path } });
    } catch (error) {
      throw createTauriCommandError('system_fs_open_with_default', error, { path });
    }
  }
}

class PinnedAPI {
  async list(): Promise<PinnedPathsState> {
    try {
      return await api.invoke('pinned_list');
    } catch (error) {
      throw createTauriCommandError('pinned_list', error);
    }
  }

  async add(path: string, label?: string): Promise<PinnedPath> {
    try {
      return await api.invoke('pinned_add', { request: { path, label } });
    } catch (error) {
      throw createTauriCommandError('pinned_add', error, { path, label });
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await api.invoke('pinned_remove', { request: { id } });
    } catch (error) {
      throw createTauriCommandError('pinned_remove', error, { id });
    }
  }

  async reorder(ids: string[]): Promise<PinnedPathsState> {
    try {
      return await api.invoke('pinned_reorder', { request: { ids } });
    } catch (error) {
      throw createTauriCommandError('pinned_reorder', error, { ids });
    }
  }
}

class FilesContextAPI {
  async stash(sessionId: string, context: FilesContext): Promise<void> {
    try {
      await api.invoke('stash_files_context', {
        request: { sessionId, context },
      });
    } catch (error) {
      throw createTauriCommandError('stash_files_context', error, { sessionId, context });
    }
  }
}

export const systemFsAPI = new SystemFsAPI();
export const pinnedAPI = new PinnedAPI();
export const filesContextAPI = new FilesContextAPI();
