import { getFileCategory } from './fileClassification';
import type { BrowserSortBy, FileEntry, SortOrder } from '../types';

export function sortComparableDate(value?: string): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function getRecencyAttr(modified?: string): 'today' | 'week' | 'month' | 'old' {
  if (!modified) return 'old';
  const age = Date.now() - new Date(modified).getTime();
  if (age < 86_400_000) return 'today';
  if (age < 604_800_000) return 'week';
  if (age < 2_592_000_000) return 'month';
  return 'old';
}

export function filterAndSortEntries(
  entries: FileEntry[],
  searchQuery: string,
  sortBy: BrowserSortBy,
  sortOrder: SortOrder,
): FileEntry[] {
  const query = searchQuery.trim().toLowerCase();
  return [...entries]
    .filter((entry) => !entry.hidden)
    .filter((entry) => !query || entry.name.toLowerCase().includes(query) || entry.path.toLowerCase().includes(query))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;

      let comparison = 0;
      switch (sortBy) {
        case 'modified':
          comparison = sortComparableDate(a.modified) - sortComparableDate(b.modified);
          break;
        case 'size':
          comparison = (a.size || 0) - (b.size || 0);
          break;
        case 'type':
          comparison = getFileCategory(a).localeCompare(getFileCategory(b));
          break;
        case 'name':
        default:
          comparison = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
          break;
      }

      return sortOrder === 'desc' ? -comparison : comparison;
    });
}
