import { fileEntryFromFsEntry, getFileCategory } from '../services/fileClassification';
import type { FileEntry, FileScope, SmartCollectionId } from '../types';
import { systemFileProvider } from './SystemFileProvider';

const MAX_ROOT_ENTRIES = 120;
const MAX_COLLECTION_ITEMS = 80;
const LARGE_FILE_BYTES = 50 * 1024 * 1024;
const RECENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export class SmartCollectionProvider {
  async list(collection: SmartCollectionId, roots: string[]): Promise<FileEntry[]> {
    const scopedEntries: FileEntry[] = [];

    for (const root of roots.slice(0, 6)) {
      const entries = await systemFileProvider.listDir(root).catch(() => []);
      for (const entry of entries.slice(0, MAX_ROOT_ENTRIES)) {
        if (!this.matches(collection, entry)) continue;
        const scope: FileScope = { kind: 'smart', collection };
        scopedEntries.push(fileEntryFromFsEntry(entry, scope));
      }
    }

    return scopedEntries
      .sort((a, b) => {
        if (collection === 'large-files') return (b.size ?? 0) - (a.size ?? 0);
        return Date.parse(b.modified || '') - Date.parse(a.modified || '');
      })
      .slice(0, MAX_COLLECTION_ITEMS);
  }

  private matches(collection: SmartCollectionId, entry: FileEntry): boolean {
    const category = getFileCategory(entry);
    const name = entry.name.toLowerCase();
    const modifiedAt = Date.parse(entry.modified || '');

    switch (collection) {
      case 'large-files':
        return entry.kind !== 'dir' && (entry.size ?? 0) >= LARGE_FILE_BYTES;
      case 'recently-modified':
        return Number.isFinite(modifiedAt) && Date.now() - modifiedAt <= RECENT_WINDOW_MS;
      case 'screenshots':
        return category === 'image' && /screenshot|screen shot|截屏|截图/.test(name);
      case 'archives':
        return category === 'archive';
      case 'code-projects':
        return entry.kind === 'dir' && /src|app|packages|crates|node_modules|\.git/.test(name);
      default:
        return false;
    }
  }
}

export const smartCollectionProvider = new SmartCollectionProvider();
