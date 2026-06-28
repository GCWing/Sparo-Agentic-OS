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
  | 'app-detail'
  | 'component-center'
  | 'create-app'
  | 'create-component';

export type ProductAppFilter =
  | 'all'
  | 'installed'
  | 'discover'
  | 'conversation'
  | 'interactive';

export type ManageSortKey = 'name' | 'scope' | 'status';

export type ComponentCenterFilter = 'all' | ComponentKind;

interface AppsStoreState {
  page: AppsScenePage;
  /** The page that was active before navigating to app-detail, so we can return to it. */
  detailReturnPage: AppsScenePage;
  productAppFilter: ProductAppFilter;
  componentFilter: ComponentCenterFilter;
  launchSearch: string;
  manageSearch: string;
  componentSearch: string;
  manageSort: ManageSortKey;
  selectedAppId: string | null;
  selectedComponentId: string | null;
  setProductAppFilter: (filter: ProductAppFilter) => void;
  setComponentFilter: (filter: ComponentCenterFilter) => void;
  setLaunchSearch: (query: string) => void;
  setManageSearch: (query: string) => void;
  setComponentSearch: (query: string) => void;
  setManageSort: (sort: ManageSortKey) => void;
  openHome: () => void;
  openManage: (appId?: string | null) => void;
  openAppDetail: (appId: string) => void;
  openComponentCenter: (componentId?: string | null) => void;
  openCreateApp: () => void;
  openCreateComponent: () => void;
}

export const useAppsStore = create<AppsStoreState>((set) => ({
  page: 'home',
  detailReturnPage: 'home',
  productAppFilter: 'all',
  componentFilter: 'all',
  launchSearch: '',
  manageSearch: '',
  componentSearch: '',
  manageSort: 'name',
  selectedAppId: null,
  selectedComponentId: null,
  setProductAppFilter: (productAppFilter) =>
    set({ productAppFilter, page: 'manage', selectedAppId: null }),
  setComponentFilter: (componentFilter) =>
    set({ componentFilter, page: 'component-center' }),
  setLaunchSearch: (launchSearch) => set({ launchSearch }),
  setManageSearch: (manageSearch) => set({ manageSearch }),
  setComponentSearch: (componentSearch) => set({ componentSearch }),
  setManageSort: (manageSort) => set({ manageSort }),
  openHome: () => set({ page: 'home', detailReturnPage: 'home', selectedAppId: null, selectedComponentId: null }),
  openManage: (appId = null) => set({
    page: 'manage',
    detailReturnPage: 'manage',
    selectedAppId: appId ?? null,
    selectedComponentId: null,
  }),
  openAppDetail: (appId) => set((state) => ({
    page: 'app-detail',
    selectedAppId: appId,
    detailReturnPage: state.page === 'app-detail' ? state.detailReturnPage : state.page,
  })),
  openComponentCenter: (componentId = null) =>
    set({ page: 'component-center', selectedComponentId: componentId ?? null }),
  openCreateApp: () => set({ page: 'create-app', selectedAppId: null }),
  openCreateComponent: () => set({ page: 'create-component', selectedComponentId: null }),
}));
