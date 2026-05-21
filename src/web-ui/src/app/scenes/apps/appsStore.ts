/**
 * Apps scene navigation store.
 *
 * The scene has two top-level pages: a Home (discover/manage) and an App
 * detail workbench. Per-app workbench state (active tab, active agent, drafts) lives
 * in {@link useAppDetailStore} instead so it resets cleanly when switching
 * apps and so the home page does not need to know about it.
 */
import { create } from 'zustand';

export type AppsScenePage = 'home' | 'app-detail';
export type AppsTab = 'all' | 'agent-app' | 'live-app' | 'bridge-app';
export type AppsHomeView = 'discover' | 'manage';

interface AppsStoreState {
  activeTab: AppsTab;
  page: AppsScenePage;
  searchQuery: string;
  homeView: AppsHomeView;
  homeListPage: number;
  selectedAppId: string | null;
  setActiveTab: (tab: AppsTab) => void;
  setSearchQuery: (query: string) => void;
  setHomeView: (view: AppsHomeView) => void;
  setHomeListPage: (page: number | ((current: number) => number)) => void;
  openHome: () => void;
  openAppDetail: (appId: string) => void;
}

export const useAppsStore = create<AppsStoreState>((set) => ({
  activeTab: 'all',
  page: 'home',
  searchQuery: '',
  homeView: 'discover',
  homeListPage: 0,
  selectedAppId: null,
  setActiveTab: (activeTab) =>
    set({ activeTab, page: 'home', selectedAppId: null, homeListPage: 0 }),
  setSearchQuery: (query) => set({ searchQuery: query, homeListPage: 0 }),
  setHomeView: (homeView) => set({ homeView }),
  setHomeListPage: (pageOrUpdater) =>
    set((state) => ({
      homeListPage:
        typeof pageOrUpdater === 'function'
          ? pageOrUpdater(state.homeListPage)
          : pageOrUpdater,
    })),
  openHome: () => set({ page: 'home', selectedAppId: null }),
  openAppDetail: (appId) => set({ page: 'app-detail', selectedAppId: appId }),
}));
