import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SettingsMode = 'manual' | 'ai';

export interface SettingsLocation {
  tabId: string;
  sectionId?: string;
  fieldId?: string;
}

interface SettingsState {
  mode: SettingsMode;
  activeTab: string;
  searchQuery: string;
  manualTarget: SettingsLocation | null;
  dirtySettings: Readonly<Record<string, number>>;
  setMode: (mode: SettingsMode) => void;
  setActiveTab: (tabId: string) => void;
  setSearchQuery: (query: string) => void;
  openManualLocation: (location: SettingsLocation) => void;
  clearManualTarget: () => void;
  markSettingDirty: (settingId: string, baseRevision: number) => void;
  clearSettingDirty: (settingId: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      mode: 'manual',
      activeTab: 'basics',
      searchQuery: '',
      manualTarget: null,
      dirtySettings: {},

      setMode: (mode) => set({ mode }),
      setActiveTab: (activeTab) => set({
        mode: 'manual',
        activeTab,
        manualTarget: { tabId: activeTab },
      }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      openManualLocation: (manualTarget) => set({
        mode: 'manual',
        activeTab: manualTarget.tabId,
        manualTarget,
        searchQuery: '',
      }),
      clearManualTarget: () => set({ manualTarget: null }),
      markSettingDirty: (settingId, baseRevision) => set((state) => ({
        dirtySettings: {
          ...state.dirtySettings,
          [settingId]: baseRevision,
        },
      })),
      clearSettingDirty: (settingId) => set((state) => {
        if (!(settingId in state.dirtySettings)) {
          return state;
        }
        const dirtySettings = { ...state.dirtySettings };
        delete dirtySettings[settingId];
        return { dirtySettings };
      }),
    }),
    {
      name: 'sparo-settings-scene',
      partialize: (state) => ({
        mode: state.mode,
        activeTab: state.activeTab,
      }),
    },
  ),
);
