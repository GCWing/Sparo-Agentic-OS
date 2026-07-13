import { create } from 'zustand';
import type {
  SkillLibrarySourceFilter,
  SkillLibraryTypeFilter,
} from '@/shared/skillLibrary';

interface SkillsSceneState {
  searchDraft: string;
  marketQuery: string;
  installedTypeFilter: SkillLibraryTypeFilter;
  installedSourceFilter: SkillLibrarySourceFilter;
  isAddFormOpen: boolean;
  setSearchDraft: (value: string) => void;
  submitMarketQuery: () => void;
  setInstalledTypeFilter: (filter: SkillLibraryTypeFilter) => void;
  setInstalledSourceFilter: (filter: SkillLibrarySourceFilter) => void;
  setAddFormOpen: (open: boolean) => void;
  toggleAddForm: () => void;
}

export const useSkillsSceneStore = create<SkillsSceneState>((set) => ({
  searchDraft: '',
  marketQuery: '',
  installedTypeFilter: 'all',
  installedSourceFilter: 'all',
  isAddFormOpen: false,
  setSearchDraft: (value) => set({ searchDraft: value }),
  submitMarketQuery: () => set((state) => ({ marketQuery: state.searchDraft.trim() })),
  setInstalledTypeFilter: (filter) => set({ installedTypeFilter: filter }),
  setInstalledSourceFilter: (filter) => set({ installedSourceFilter: filter }),
  setAddFormOpen: (open) => set({ isAddFormOpen: open }),
  toggleAddForm: () => set((state) => ({ isAddFormOpen: !state.isAddFormOpen })),
}));
