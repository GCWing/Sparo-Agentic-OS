import { systemFsAPI } from '@/infrastructure/api';
import { fileEntryFromFsEntry } from '../services/fileClassification';
import type { FileEntry, FileScope } from '../types';

function systemScope(root?: string): FileScope {
  return { kind: 'system', root, permission: 'auto' };
}

export class SystemFileProvider {
  async listDir(path: string): Promise<FileEntry[]> {
    const entries = await systemFsAPI.listDir(path);
    return entries.map((entry) => fileEntryFromFsEntry(entry, systemScope(path)));
  }

  async stat(path: string): Promise<FileEntry> {
    const entry = await systemFsAPI.stat(path);
    return fileEntryFromFsEntry(entry, systemScope(path));
  }

  openWithDefault(path: string): Promise<void> {
    return systemFsAPI.openWithDefault(path);
  }

  revealInOs(path: string): Promise<void> {
    return systemFsAPI.revealInOs(path);
  }
}

export const systemFileProvider = new SystemFileProvider();
