/**
 * Apps scene navigation store.
 *
 * The Apps scene models Product Apps and Components directly. Runtime,
 * surface, agent, and bridge implementations stay behind component references.
 */
import { create } from 'zustand';
import type { ComponentKind } from '@/infrastructure/api/service-api/AppCatalogAPI';

export type AppsScenePage =
  | 'home'
  | 'manage'
  | 'component-center';

export type ProductAppFilter =
  | 'all'
  | 'installed'
  | 'discover'
  | 'conversation'
  | 'interactive';

export type ManageSortKey = 'attention' | 'name' | 'scope' | 'status';

export type ComponentCenterFilter = 'all' | ComponentKind;

export type AppDetailKind = 'product' | 'native';

interface AppsStoreState {
  page: AppsScenePage;
  productAppFilter: ProductAppFilter;
  componentFilter: ComponentCenterFilter;
  launchSearch: string;
  manageSearch: string;
  componentSearch: string;
  manageSort: ManageSortKey;
  selectedAppId: string | null;
  selectedAppKind: AppDetailKind | null;
  selectedComponentId: string | null;
  setProductAppFilter: (filter: ProductAppFilter) => void;
  setComponentFilter: (filter: ComponentCenterFilter) => void;
  setLaunchSearch: (query: string) => void;
  setManageSearch: (query: string) => void;
  setComponentSearch: (query: string) => void;
  setManageSort: (sort: ManageSortKey) => void;
  openHome: () => void;
  openManage: () => void;
  openAppDetail: (appId: string, kind?: AppDetailKind) => void;
  closeAppDetail: () => void;
  openComponentCenter: (componentId?: string | null) => void;
}

export const useAppsStore = create<AppsStoreState>((set) => ({
  page: 'home',
  productAppFilter: 'all',
  componentFilter: 'all',
  launchSearch: '',
  manageSearch: '',
  componentSearch: '',
  manageSort: 'attention',
  selectedAppId: null,
  selectedAppKind: null,
  selectedComponentId: null,
  setProductAppFilter: (productAppFilter) =>
    set({ productAppFilter, page: 'manage', selectedAppId: null, selectedAppKind: null }),
  setComponentFilter: (componentFilter) =>
    set({ componentFilter, page: 'component-center', selectedAppId: null, selectedAppKind: null }),
  setLaunchSearch: (launchSearch) => set({ launchSearch }),
  setManageSearch: (manageSearch) => set({ manageSearch }),
  setComponentSearch: (componentSearch) => set({ componentSearch }),
  setManageSort: (manageSort) => set({ manageSort }),
  openHome: () => set({
    page: 'home',
    selectedAppId: null,
    selectedAppKind: null,
    selectedComponentId: null,
  }),
  openManage: () => set({
    page: 'manage',
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
  openComponentCenter: (componentId = null) =>
    set({
      page: 'component-center',
      selectedAppId: null,
      selectedAppKind: null,
      selectedComponentId: componentId ?? null,
    }),
}));
