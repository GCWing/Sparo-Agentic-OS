import type { FileEntry, SelectionIntent } from '../types';

export interface FileSelectionState {
  selectedEntries: FileEntry[];
  anchorPath: string | null;
}

export function applyFileSelection(
  entries: FileEntry[],
  state: FileSelectionState,
  entry: FileEntry,
  intent: SelectionIntent,
): FileSelectionState {
  if (intent.range && state.anchorPath) {
    const anchorIndex = entries.findIndex((item) => item.path === state.anchorPath);
    const entryIndex = entries.findIndex((item) => item.path === entry.path);
    if (anchorIndex >= 0 && entryIndex >= 0) {
      const start = Math.min(anchorIndex, entryIndex);
      const end = Math.max(anchorIndex, entryIndex);
      return { selectedEntries: entries.slice(start, end + 1), anchorPath: state.anchorPath };
    }
  }

  if (intent.additive) {
    const exists = state.selectedEntries.some((item) => item.path === entry.path);
    const selectedEntries = exists
      ? state.selectedEntries.filter((item) => item.path !== entry.path)
      : [...state.selectedEntries, entry];
    return { selectedEntries, anchorPath: entry.path };
  }

  return { selectedEntries: [entry], anchorPath: entry.path };
}

export function selectAllFiles(entries: FileEntry[]): FileSelectionState {
  return { selectedEntries: entries, anchorPath: entries[0]?.path ?? null };
}

export function keepVisibleSelection(selectedEntries: FileEntry[], visibleEntries: FileEntry[]): FileEntry[] {
  const visiblePaths = new Set(visibleEntries.map((entry) => entry.path));
  return selectedEntries.filter((selected) => visiblePaths.has(selected.path));
}
