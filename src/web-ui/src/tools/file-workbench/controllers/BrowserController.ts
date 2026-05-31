import { filterAndSortEntries } from '../services/fileSorting';
import type { BrowserSortBy, FileEntry, FileScope, SortOrder } from '../types';

export interface BrowserControllerState {
  scope: FileScope;
  cwd: string;
  entries: FileEntry[];
  searchQuery: string;
  sortBy: BrowserSortBy;
  sortOrder: SortOrder;
  history: string[];
}

export function createBrowserState(scope: FileScope, cwd: string): BrowserControllerState {
  return {
    scope,
    cwd,
    entries: [],
    searchQuery: '',
    sortBy: 'name',
    sortOrder: 'asc',
    history: cwd ? [cwd] : [],
  };
}

export function getVisibleEntries(state: BrowserControllerState): FileEntry[] {
  return filterAndSortEntries(state.entries, state.searchQuery, state.sortBy, state.sortOrder);
}

export function enterDirectory(state: BrowserControllerState, cwd: string, entries: FileEntry[]): BrowserControllerState {
  const clippedHistory = state.history[state.history.length - 1] === cwd
    ? state.history
    : [...state.history, cwd];
  return {
    ...state,
    cwd,
    entries,
    searchQuery: '',
    history: clippedHistory.slice(-50),
  };
}
