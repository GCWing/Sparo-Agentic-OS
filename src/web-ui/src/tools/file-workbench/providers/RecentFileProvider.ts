import { fileEntryFromFsEntry } from '../services/fileClassification';
import type { FileEntry, FileScope } from '../types';
import { systemFileProvider } from './SystemFileProvider';

export class RecentFileProvider {
  async list(paths: string[]): Promise<FileEntry[]> {
    const entries = await Promise.all(
      paths.map(async (path): Promise<FileEntry | null> => {
        try {
          const entry = await systemFileProvider.stat(path);
          const scope: FileScope = { kind: 'recent', id: path };
          return fileEntryFromFsEntry(entry, scope);
        } catch {
          return null;
        }
      }),
    );

    return entries.filter((entry): entry is FileEntry => Boolean(entry));
  }
}

export const recentFileProvider = new RecentFileProvider();
