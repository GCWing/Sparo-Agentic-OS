/**
 * App Center navigation and user preferences.
 *
 * The center has two top-level modes. Components, drafts, and user-created
 * apps are management sections rather than destinations of
 * their own. Only the user's pinned apps are persisted.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ComponentKind } from '@/infrastructure/api/service-api/AppCatalogAPI';

export type AppsScenePage = 'home' | 'manage';
export type AppCenterView = 'installed' | 'discover';

export type ManageSection =
  | 'apps'
  | 'updates'
  | 'disabled'
  | 'creations'
  | 'drafts'
  | 'components';

export type ManageSortKey = 'attention' | 'name' | 'status';
export type ComponentCenterFilter = 'all' | ComponentKind;
export type AppDetailKind = 'product' | 'native';

const DEFAULT_PINNED_APP_IDS = ['runno', 'app-builder'];

interface AppsStoreState {
  page: AppsScenePage;
  appCenterView: AppCenterView;
  manageSection: ManageSection;
  componentFilter: ComponentCenterFilter;
  installedSearch: string;
  discoverSearch: string;
  manageSearch: string;
  componentSearch: string;
  manageSort: ManageSortKey;
  pinnedAppIds: string[];
  selectedAppId: string | null;
  selectedAppKind: AppDetailKind | null;
  selectedComponentId: string | null;
  setAppCenterView: (view: AppCenterView) => void;
  setManageSection: (section: ManageSection) => void;
  setComponentFilter: (filter: ComponentCenterFilter) => void;
  setInstalledSearch: (query: string) => void;
  setDiscoverSearch: (query: string) => void;
  setManageSearch: (query: string) => void;
  setComponentSearch: (query: string) => void;
  setManageSort: (sort: ManageSortKey) => void;
  togglePinnedApp: (appId: string) => void;
  openHome: () => void;
  openManage: (section?: ManageSection) => void;
  openAppDetail: (appId: string, kind?: AppDetailKind) => void;
  closeAppDetail: () => void;
  openComponentCenter: (componentId?: string | null) => void;
}

export const useAppsStore = create<AppsStoreState>()(persist(
  (set) => ({
    page: 'home',
    appCenterView: 'installed',
    manageSection: 'apps',
    componentFilter: 'all',
    installedSearch: '',
    discoverSearch: '',
    manageSearch: '',
    componentSearch: '',
    manageSort: 'attention',
    pinnedAppIds: DEFAULT_PINNED_APP_IDS,
    selectedAppId: null,
    selectedAppKind: null,
    selectedComponentId: null,
    setAppCenterView: (appCenterView) => set({ appCenterView, page: 'home' }),
    setManageSection: (manageSection) => set({
      manageSection,
      page: 'manage',
      selectedAppId: null,
      selectedAppKind: null,
      selectedComponentId: null,
    }),
    setComponentFilter: (componentFilter) => set({
      componentFilter,
      page: 'manage',
      manageSection: 'components',
      selectedAppId: null,
      selectedAppKind: null,
    }),
    setInstalledSearch: (installedSearch) => set({ installedSearch }),
    setDiscoverSearch: (discoverSearch) => set({ discoverSearch }),
    setManageSearch: (manageSearch) => set({ manageSearch }),
    setComponentSearch: (componentSearch) => set({ componentSearch }),
    setManageSort: (manageSort) => set({ manageSort }),
    togglePinnedApp: (appId) => set((state) => ({
      pinnedAppIds: state.pinnedAppIds.includes(appId)
        ? state.pinnedAppIds.filter((id) => id !== appId)
        : [...state.pinnedAppIds, appId].slice(-8),
    })),
    openHome: () => set({
      page: 'home',
      selectedAppId: null,
      selectedAppKind: null,
      selectedComponentId: null,
    }),
    openManage: (manageSection = 'apps') => set({
      page: 'manage',
      manageSection,
      selectedAppId: null,
      selectedAppKind: null,
      selectedComponentId: null,
    }),
    openAppDetail: (appId, kind = 'product') => set({
      selectedAppId: appId,
      selectedAppKind: kind,
    }),
    closeAppDetail: () => set({
      selectedAppId: null,
      selectedAppKind: null,
    }),
    openComponentCenter: (componentId = null) => set({
      page: 'manage',
      manageSection: 'components',
      selectedAppId: null,
      selectedAppKind: null,
      selectedComponentId: componentId ?? null,
    }),
  }),
  {
    name: 'sparo-app-center-preferences',
    storage: createJSONStorage(() => localStorage),
    partialize: (state) => ({ pinnedAppIds: state.pinnedAppIds }),
  },
));
