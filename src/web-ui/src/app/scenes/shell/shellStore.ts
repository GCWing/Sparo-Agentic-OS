import { create } from 'zustand';
import {
  DEFAULT_SHELL_NAV_FILTERS,
  SHELL_NAV_FILTER_ORDER,
  type ShellNavFilter,
} from './shellConfig';

interface ShellState {
  activeFilters: ShellNavFilter[];
  setActiveFilters: (filters: ShellNavFilter[]) => void;
  toggleFilter: (filter: ShellNavFilter) => void;
}

function normalizeFilters(filters: ShellNavFilter[]): ShellNavFilter[] {
  const unique = Array.from(new Set(filters));
  const normalized = SHELL_NAV_FILTER_ORDER.filter((filter) => unique.includes(filter));
  return normalized.length > 0 ? normalized : [...DEFAULT_SHELL_NAV_FILTERS];
}

export const useShellStore = create<ShellState>((set) => ({
  activeFilters: [...DEFAULT_SHELL_NAV_FILTERS],
  setActiveFilters: (filters) => set({ activeFilters: normalizeFilters(filters) }),
  toggleFilter: (filter) => set((state) => {
    const isActive = state.activeFilters.includes(filter);

    if (!isActive) {
      return { activeFilters: normalizeFilters([...state.activeFilters, filter]) };
    }

    if (state.activeFilters.length === 1) {
      return { activeFilters: [...DEFAULT_SHELL_NAV_FILTERS] };
    }

    return {
      activeFilters: state.activeFilters.filter((value) => value !== filter),
    };
  }),
}));
