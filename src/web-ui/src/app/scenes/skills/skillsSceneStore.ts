import { create } from 'zustand';

export type InstalledFilter = 'all' | 'builtin' | 'user' | 'project' | 'suite';

interface SkillsSceneState {
  searchDraft: string;
  marketQuery: string;
  installedFilter: InstalledFilter;
  isAddFormOpen: boolean;
  setSearchDraft: (value: string) => void;
  submitMarketQuery: () => void;
  setInstalledFilter: (filter: InstalledFilter) => void;
  setAddFormOpen: (open: boolean) => void;
  toggleAddForm: () => void;
}

export const useSkillsSceneStore = create<SkillsSceneState>((set) => ({
  searchDraft: '',
  marketQuery: '',
  installedFilter: 'all',
  isAddFormOpen: false,
  setSearchDraft: (value) => set({ searchDraft: value }),
  submitMarketQuery: () => set((state) => ({ marketQuery: state.searchDraft.trim() })),
  setInstalledFilter: (filter) => set({ installedFilter: filter }),
  setAddFormOpen: (open) => set({ isAddFormOpen: open }),
  toggleAddForm: () => set((state) => ({ isAddFormOpen: !state.isAddFormOpen })),
}));
