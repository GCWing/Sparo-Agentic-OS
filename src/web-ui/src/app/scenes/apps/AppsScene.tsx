import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BriefcaseBusiness,
  Download,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { ManagementList, ManageViewToggle, type ManageViewMode } from './components/ManagementList';
import { ComponentCenter } from './components/ComponentCenter';
import { AppCenterModeNav } from './components/AppCenterModeNav';
import { CardExpandPanel, CardPrimaryAction, CardStackLink, WorkCardBack, WorkCardFrame, WorkStack } from './components/WorkStack';
import type { AppCenterMode } from './components/types';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  DotMatrixLoader,
  EmptyState,
  IconButton,
  ItemCard,
  ItemCardTitle,
  ItemCardTop,
  Panel,
  PanelBody,
  PanelHeader,
  Scene,
  SceneBody,
  SearchToolbar,
  SegmentedControl,
  StatusDot,
} from '@/design-system';
import {
  appCatalogAPI,
  type AppComponentRef,
  type AppIconSpec,
  type ComponentDefinition,
  type NativeAppCatalogEntry,
  type ProductAppCatalogEntry,
} from '@/infrastructure/api/service-api/AppCatalogAPI';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import {
  NewWorkDialog,
  launchWorkForChoice,
  productAppWorkChoice,
} from '@/app/components/WorkDock/NewWorkDialog';
import {
  catalogAppRequiresWorkspace,
  getCatalogAppLaunchBehavior,
  getNativeAppLaunchBehavior,
} from '@/app/agentic-os/work/domain/productAppLaunchPolicy';
import { useWorkStore } from '@/app/agentic-os/work/data/workStore';
import { openWork, openWorkCenterHome } from '@/app/agentic-os/work/navigation/openWork';
import {
  nativeAppWorkRef,
  productAppWorkRef,
  sameAppRef,
  sameProductAppRef,
} from '@/app/agentic-os/work/domain/productAppRefs';
import type { WorkAppRef, WorkRecord } from '@/app/agentic-os/work/domain/workTypes';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import { useAppsStore, type ManageSortKey, type ProductAppFilter } from './appsStore';
import { AppDetailScene } from './app-detail/AppDetailScene';
import './app-detail/AppDetailScene.scss';
import { useProductAppRuntimeStore } from './product-app-runtime/productAppRuntimeStore';
import { productAppRuntimeHostAPI } from '@/infrastructure/api/service-api/ProductAppRuntimeHostAPI';
import { mergeProductAppLibrary, productAppLibraryKey } from './productAppLibrary';
import { AppIcon } from './AppIcon';
import { NATIVE_SYSTEM_APP_CATALOG, withShellNativeAppIcons } from './nativeSystemCatalog';
import './AppsScene.scss';

const log = createLogger('AppsScene');

const PRODUCT_FILTERS: ProductAppFilter[] = ['all', 'installed', 'discover', 'conversation', 'interactive'];

const MANAGE_SORT_KEYS: ManageSortKey[] = ['attention', 'name', 'status', 'scope'];
const HOME_APP_FIRST_REVEAL_DELAY_MS = 40;
const HOME_APP_REVEAL_INTERVAL_MS = 120;

const NATIVE_AGENT_CHOICES_BY_APP_ID: Record<string, 'agentic' | 'Cowork' | 'Design'> = {
  'prime-builder': 'agentic',
  cowork: 'Cowork',
  design: 'Design',
};

type AppDisplayEntry = Pick<
  NativeAppCatalogEntry | ProductAppCatalogEntry,
  'id' | 'name' | 'description' | 'goal' | 'icon' | 'category' | 'tags'
> & {
  dependencySummary?: string | null;
};

function isAssetIcon(icon: AppIconSpec): boolean {
  return icon.kind === 'packageAsset' || icon.kind === 'nativeAsset';
}

function sortManageApps(
  filtered: ProductAppCatalogEntry[],
  sort: ManageSortKey,
  runningIds: Set<string>,
): ProductAppCatalogEntry[] {
  const sorted = [...filtered];
  switch (sort) {
    case 'attention':
      sorted.sort((a, b) => {
        const weight = (app: ProductAppCatalogEntry): number => {
          if (appHasCatalogIssues(app)) return 0;
          if (app.installed === true && app.updateAvailable === true) return 1;
          if (app.installed === true && app.enabled !== true) return 2;
          if (app.installed !== true) return 3;
          return 4;
        };
        const aWeight = weight(a);
        const bWeight = weight(b);
        if (aWeight !== bWeight) return aWeight - bWeight;
        return a.name.localeCompare(b.name);
      });
      break;
    case 'name':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'status':
      sorted.sort((a, b) => {
        const aRunning = runningIds.has(a.id) ? 0 : 1;
        const bRunning = runningIds.has(b.id) ? 0 : 1;
        if (aRunning !== bRunning) return aRunning - bRunning;
        return a.name.localeCompare(b.name);
      });
      break;
    case 'scope':
      sorted.sort((a, b) => {
        const order: Record<string, number> = { system: 0, workspace: 1, project: 2 };
        const aScope = order[a.installScope] ?? 3;
        const bScope = order[b.installScope] ?? 3;
        if (aScope !== bScope) return aScope - bScope;
        return a.name.localeCompare(b.name);
      });
      break;
  }
  return sorted;
}

const OPEN_WORK_STATUSES = new Set<WorkRecord['status']>([
  'active',
  'running',
  'waiting_user',
  'blocked',
  'paused',
  'interrupted',
]);

function normalized(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function appHasCatalogIssues(app: ProductAppCatalogEntry): boolean {
  return (app.catalogIssues?.length ?? 0) > 0;
}

function appMatchesSearch(app: AppDisplayEntry, query: string): boolean {
  if (!query) return true;
  const haystack = [
    app.id,
    app.name,
    app.description,
    app.goal,
    app.category,
    ...(app.tags ?? []),
    app.dependencySummary ?? '',
  ].map(normalized).join(' ');
  return haystack.includes(query);
}

function workMatchesSearch(work: WorkRecord, appName: string | undefined, query: string): boolean {
  if (!query) return true;
  const haystack = [
    work.id,
    work.title,
    work.objective,
    appName ?? '',
  ].map(normalized).join(' ');
  return haystack.includes(query);
}

function componentMatchesSearch(component: ComponentDefinition, query: string): boolean {
  if (!query) return true;
  const haystack = [
    component.id,
    component.name,
    component.description,
    component.kind,
    component.version ?? '',
    component.implementationRef ?? '',
    ...(component.usedByApps ?? []),
    ...(component.capabilities ?? []).flatMap((capability) => [
      capability.id,
      capability.title,
      capability.description ?? '',
      ...(capability.actions ?? []),
    ]),
  ].map(normalized).join(' ');
  return haystack.includes(query);
}

function filterProductApp(app: ProductAppCatalogEntry, filter: ProductAppFilter): boolean {
  switch (filter) {
    case 'installed':
      return app.installed === true;
    case 'discover':
      return app.discoverable === true || app.updateAvailable === true;
    case 'conversation':
      return app.interactionModel === 'conversation';
    case 'interactive':
      return app.interactionModel === 'interactiveWorkspace';
    case 'all':
    default:
      return true;
  }
}

function nativeAppSupportsMultipleWorks(app: NativeAppCatalogEntry): boolean {
  return getNativeAppLaunchBehavior(app).supportsMultipleWorks;
}

function nativeAgentChoiceForApp(app: NativeAppCatalogEntry): string | null {
  return NATIVE_AGENT_CHOICES_BY_APP_ID[app.id] ?? app.launch?.agentType ?? app.launch?.targetId ?? null;
}

function appRefFromWork(work: WorkRecord): WorkAppRef | null {
  if (work.subject.kind === 'app') return work.subject.app;
  return work.appRefs.find((relation) => relation.role === 'subject')?.app
    ?? work.appRefs.find((relation) => relation.role === 'executor')?.app
    ?? work.appRefs[0]?.app
    ?? null;
}

function resolveAppComponents(
  app: ProductAppCatalogEntry,
  components: ComponentDefinition[],
): Array<{ ref: AppComponentRef; component: ComponentDefinition | null }> {
  return (app.components ?? []).map((ref) => ({
    ref,
    component: components.find((candidate) => (
      candidate.id === ref.componentId
      && candidate.kind === ref.kind
      && (
        ref.source === 'shared'
        || candidate.ownerApp?.appId === app.id
      )
    )) ?? null,
  }));
}

function statusVariant(status: WorkRecord['status']): 'neutral' | 'success' | 'warning' | 'error' | 'info' {
  if (status === 'running') return 'success';
  if (status === 'waiting_user' || status === 'blocked') return 'warning';
  if (status === 'failed' || status === 'cancelled' || status === 'interrupted') return 'error';
  if (status === 'completed') return 'info';
  return 'neutral';
}

function modeForPage(page: ReturnType<typeof useAppsStore.getState>['page']): AppCenterMode {
  if (page === 'manage') return 'manage';
  if (page === 'component-center') return 'component-center';
  return 'home';
}

export const AppsScene: React.FC = () => {
  const { t } = useTranslation('scenes/apps');
  const {
    lastUsedWorkspace,
    rememberWorkspace,
  } = useWorkspaceContext();

  const {
    page,
    productAppFilter,
    componentFilter,
    launchSearch,
    manageSearch,
    componentSearch,
    manageSort,
    selectedAppId,
    selectedAppKind,
    selectedComponentId,
    setProductAppFilter,
    setComponentFilter,
    setLaunchSearch,
    setManageSearch,
    setComponentSearch,
    setManageSort,
    openHome,
    openManage,
    openAppDetail,
    closeAppDetail,
    openComponentCenter,
  } = useAppsStore();

  const works = useWorkStore((state) => state.works);
  const worksLoaded = useWorkStore((state) => state.loaded);
  const refreshWorks = useWorkStore((state) => state.refreshWorks);
  const controlWork = useWorkStore((state) => state.controlWork);
  const runningProductAppRuntimeIds = useProductAppRuntimeStore((state) => state.runningWorkerIds);
  const markProductAppRuntimeWorkerStopped = useProductAppRuntimeStore((state) => state.markWorkerStopped);

  const [homeApps, setHomeApps] = useState<ProductAppCatalogEntry[]>([]);
  const [visibleHomeApps, setVisibleHomeApps] = useState<ProductAppCatalogEntry[]>([]);
  const [homeRevealPendingCount, setHomeRevealPendingCount] = useState(0);
  const [visibleDiscoverApps, setVisibleDiscoverApps] = useState<ProductAppCatalogEntry[]>([]);
  const [discoverRevealPendingCount, setDiscoverRevealPendingCount] = useState(0);
  const [libraryApps, setLibraryApps] = useState<ProductAppCatalogEntry[]>([]);
  const [nativeApps, setNativeApps] = useState<NativeAppCatalogEntry[]>(NATIVE_SYSTEM_APP_CATALOG);
  const [components, setComponents] = useState<ComponentDefinition[]>([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [componentsLoaded, setComponentsLoaded] = useState(false);
  const [nativeLoading, setNativeLoading] = useState(false);
  const [productHomeLoading, setProductHomeLoading] = useState(true);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [componentsLoading, setComponentsLoading] = useState(false);
  const [launchingAppId, setLaunchingAppId] = useState<string | null>(null);
  const [stoppingAppId, setStoppingAppId] = useState<string | null>(null);
  const [managingAppId, setManagingAppId] = useState<string | null>(null);
  const [closingResumeWorkId, setClosingResumeWorkId] = useState<string | null>(null);
  const [flippedAppId, setFlippedAppId] = useState<string | null>(null);
  const [workspaceLaunchApp, setWorkspaceLaunchApp] = useState<ProductAppCatalogEntry | null>(null);
  const [nativeLoadError, setNativeLoadError] = useState<string | null>(null);
  const [productHomeLoadError, setProductHomeLoadError] = useState<string | null>(null);
  const [libraryLoadError, setLibraryLoadError] = useState<string | null>(null);
  const [componentsLoadError, setComponentsLoadError] = useState<string | null>(null);
  const nativeLoadIdRef = useRef(0);
  const productHomeLoadIdRef = useRef(0);
  const libraryLoadIdRef = useRef(0);
  const componentsLoadIdRef = useRef(0);
  const pageRetryRef = useRef<string | null>(null);
  const homeRevealQueueRef = useRef<ProductAppCatalogEntry[]>([]);
  const discoverRevealQueueRef = useRef<ProductAppCatalogEntry[]>([]);
  const visibleHomeAppKeysRef = useRef<Set<string>>(new Set());
  const visibleDiscoverAppKeysRef = useRef<Set<string>>(new Set());
  const homeRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const discoverRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHomeRevealTimer = useCallback(() => {
    if (homeRevealTimerRef.current) {
      clearTimeout(homeRevealTimerRef.current);
      homeRevealTimerRef.current = null;
    }
  }, []);

  const clearDiscoverRevealTimer = useCallback(() => {
    if (discoverRevealTimerRef.current) {
      clearTimeout(discoverRevealTimerRef.current);
      discoverRevealTimerRef.current = null;
    }
  }, []);

  const revealNextHomeApp = useCallback(() => {
    const next = homeRevealQueueRef.current.shift();
    if (!next) {
      setHomeRevealPendingCount(0);
      homeRevealTimerRef.current = null;
      return;
    }

    setVisibleHomeApps((current) => {
      const nextKey = productAppLibraryKey(next);
      const nextVisible = [
        ...current.filter((app) => productAppLibraryKey(app) !== nextKey),
        next,
      ];
      visibleHomeAppKeysRef.current = new Set(nextVisible.map(productAppLibraryKey));
      return nextVisible;
    });
    setHomeRevealPendingCount(homeRevealQueueRef.current.length);

    if (homeRevealQueueRef.current.length > 0) {
      homeRevealTimerRef.current = setTimeout(revealNextHomeApp, HOME_APP_REVEAL_INTERVAL_MS);
    } else {
      homeRevealTimerRef.current = null;
    }
  }, []);

  const revealNextDiscoverApp = useCallback(() => {
    const next = discoverRevealQueueRef.current.shift();
    if (!next) {
      setDiscoverRevealPendingCount(0);
      discoverRevealTimerRef.current = null;
      return;
    }

    setVisibleDiscoverApps((current) => {
      const nextKey = productAppLibraryKey(next);
      const nextVisible = [
        ...current.filter((app) => productAppLibraryKey(app) !== nextKey),
        next,
      ];
      visibleDiscoverAppKeysRef.current = new Set(nextVisible.map(productAppLibraryKey));
      return nextVisible;
    });
    setDiscoverRevealPendingCount(discoverRevealQueueRef.current.length);

    if (discoverRevealQueueRef.current.length > 0) {
      discoverRevealTimerRef.current = setTimeout(revealNextDiscoverApp, HOME_APP_REVEAL_INTERVAL_MS);
    } else {
      discoverRevealTimerRef.current = null;
    }
  }, []);

  const beginHomeAppReveal = useCallback((nextApps: ProductAppCatalogEntry[]) => {
    clearHomeRevealTimer();
    const nextByKey = new Map(nextApps.map((app) => [productAppLibraryKey(app), app]));
    const retainedKeys = new Set(
      [...visibleHomeAppKeysRef.current].filter((key) => nextByKey.has(key)),
    );

    visibleHomeAppKeysRef.current = retainedKeys;
    setVisibleHomeApps((current) => current
      .filter((app) => nextByKey.has(productAppLibraryKey(app)))
      .map((app) => nextByKey.get(productAppLibraryKey(app)) ?? app));

    const revealQueue = nextApps.filter((app) => !retainedKeys.has(productAppLibraryKey(app)));
    homeRevealQueueRef.current = revealQueue;
    setHomeRevealPendingCount(revealQueue.length);

    if (revealQueue.length > 0) {
      homeRevealTimerRef.current = setTimeout(revealNextHomeApp, HOME_APP_FIRST_REVEAL_DELAY_MS);
    }
  }, [clearHomeRevealTimer, revealNextHomeApp]);

  const beginDiscoverAppReveal = useCallback((nextApps: ProductAppCatalogEntry[]) => {
    clearDiscoverRevealTimer();
    const nextByKey = new Map(nextApps.map((app) => [productAppLibraryKey(app), app]));
    const retainedKeys = new Set(
      [...visibleDiscoverAppKeysRef.current].filter((key) => nextByKey.has(key)),
    );

    visibleDiscoverAppKeysRef.current = retainedKeys;
    setVisibleDiscoverApps((current) => current
      .filter((app) => nextByKey.has(productAppLibraryKey(app)))
      .map((app) => nextByKey.get(productAppLibraryKey(app)) ?? app));

    const revealQueue = nextApps.filter((app) => !retainedKeys.has(productAppLibraryKey(app)));
    discoverRevealQueueRef.current = revealQueue;
    setDiscoverRevealPendingCount(revealQueue.length);

    if (revealQueue.length > 0) {
      discoverRevealTimerRef.current = setTimeout(revealNextDiscoverApp, HOME_APP_FIRST_REVEAL_DELAY_MS);
    }
  }, [clearDiscoverRevealTimer, revealNextDiscoverApp]);

  const loadNativeCatalog = useCallback(async (options: { force?: boolean; silent?: boolean } = {}) => {
    const loadId = nativeLoadIdRef.current + 1;
    nativeLoadIdRef.current = loadId;
    const silent = options.silent === true;
    if (!silent) {
      setNativeLoading(true);
      setNativeLoadError(null);
    }
    try {
      const native = await appCatalogAPI.listNativeAppCatalog({ force: options.force });
      if (nativeLoadIdRef.current !== loadId) return;
      if (native.length === 0) {
        log.warn('Native App Center catalog was empty; keeping shell catalog');
        if (!silent) {
          setNativeLoadError('Native App Center catalog is empty.');
        }
        return;
      }
      setNativeApps(withShellNativeAppIcons(native));
      setNativeLoadError(null);
    } catch (error) {
      if (nativeLoadIdRef.current !== loadId) return;
      log.error('Failed to load native App Center catalog', { error });
      if (!silent) {
        setNativeLoadError(errorToMessage(error));
      }
    } finally {
      if (!silent && nativeLoadIdRef.current === loadId) setNativeLoading(false);
    }
  }, []);

  const loadProductHomeCatalog = useCallback(async (options: { force?: boolean } = {}) => {
    const loadId = productHomeLoadIdRef.current + 1;
    productHomeLoadIdRef.current = loadId;
    setProductHomeLoading(true);
    setProductHomeLoadError(null);
    try {
      const catalog = await appCatalogAPI.listProductAppHomeCatalog({ force: options.force });
      if (productHomeLoadIdRef.current !== loadId) return;
      setHomeApps(catalog.apps);
      beginHomeAppReveal(catalog.apps);
    } catch (error) {
      if (productHomeLoadIdRef.current !== loadId) return;
      log.error('Failed to load Product App home catalog', { error });
      setProductHomeLoadError(errorToMessage(error));
    } finally {
      if (productHomeLoadIdRef.current === loadId) setProductHomeLoading(false);
    }
  }, [beginHomeAppReveal]);

  const loadProductAppLibrary = useCallback(async (options: { force?: boolean } = {}) => {
    const loadId = libraryLoadIdRef.current + 1;
    libraryLoadIdRef.current = loadId;
    setLibraryLoading(true);
    setLibraryLoadError(null);
    try {
      const library = await appCatalogAPI.listProductAppLibrary({ force: options.force });
      if (libraryLoadIdRef.current !== loadId) return;
      const nextLibraryApps = mergeProductAppLibrary(library);
      setLibraryApps(nextLibraryApps);
      setLibraryLoaded(true);
      beginDiscoverAppReveal(nextLibraryApps
        .filter((app) => app.installed !== true)
        .filter((app) => app.discoverable === true)
        .filter((app) => !appHasCatalogIssues(app)));
    } catch (error) {
      if (libraryLoadIdRef.current !== loadId) return;
      log.error('Failed to load Product App library catalog', { error });
      setLibraryLoadError(errorToMessage(error));
    } finally {
      if (libraryLoadIdRef.current === loadId) setLibraryLoading(false);
    }
  }, [beginDiscoverAppReveal]);

  const loadComponents = useCallback(async (options: { force?: boolean } = {}) => {
    const loadId = componentsLoadIdRef.current + 1;
    componentsLoadIdRef.current = loadId;
    setComponentsLoading(true);
    setComponentsLoadError(null);
    try {
      const nextComponents = await appCatalogAPI.listComponents({ force: options.force });
      if (componentsLoadIdRef.current !== loadId) return;
      setComponents(nextComponents);
      setComponentsLoaded(true);
    } catch (error) {
      if (componentsLoadIdRef.current !== loadId) return;
      log.error('Failed to load Component catalog', { error });
      setComponentsLoadError(errorToMessage(error));
    } finally {
      if (componentsLoadIdRef.current === loadId) setComponentsLoading(false);
    }
  }, []);

  const loadCatalog = useCallback(async (options: { force?: boolean } = {}) => {
    const loads: Array<Promise<void>> = [
      loadNativeCatalog(options),
      loadProductHomeCatalog(options),
      loadProductAppLibrary(options),
    ];
    if (componentsLoaded || page === 'component-center' || selectedAppId) {
      loads.push(loadComponents(options));
    }
    await Promise.allSettled(loads);
  }, [
    componentsLoaded,
    loadComponents,
    loadNativeCatalog,
    loadProductAppLibrary,
    loadProductHomeCatalog,
    page,
    selectedAppId,
  ]);

  useEffect(() => {
    void loadNativeCatalog({ silent: true });
    void loadProductHomeCatalog().finally(() => {
      void loadProductAppLibrary();
    });
  }, [loadNativeCatalog, loadProductAppLibrary, loadProductHomeCatalog]);

  useEffect(() => () => {
    clearHomeRevealTimer();
    clearDiscoverRevealTimer();
  }, [clearDiscoverRevealTimer, clearHomeRevealTimer]);

  useEffect(() => {
    if (nativeLoading || productHomeLoading) return;
    const homeError = [nativeLoadError, productHomeLoadError].filter(Boolean).join('\n');
    const shouldRetryEmptyCatalog = !homeError && nativeApps.length === 0 && homeApps.length === 0;
    const retryReason = homeError || (shouldRetryEmptyCatalog ? 'empty-home-catalog' : null);
    if (!retryReason) return;
    const retryKey = `${page}:${retryReason}`;
    if (pageRetryRef.current === retryKey) return;
    pageRetryRef.current = retryKey;
    void Promise.allSettled([
      loadNativeCatalog({ force: true }),
      loadProductHomeCatalog({ force: true }),
    ]);
  }, [
    homeApps.length,
    loadNativeCatalog,
    loadProductHomeCatalog,
    nativeApps.length,
    nativeLoadError,
    nativeLoading,
    page,
    productHomeLoadError,
    productHomeLoading,
  ]);

  useEffect(() => {
    if (page !== 'manage' || libraryLoaded || libraryLoading) return;
    void loadProductAppLibrary();
  }, [libraryLoaded, libraryLoading, loadProductAppLibrary, page]);

  useEffect(() => {
    const shouldLoadComponents = page === 'component-center' || selectedAppId !== null;
    if (!shouldLoadComponents || componentsLoaded || componentsLoading) return;
    void loadComponents();
  }, [componentsLoaded, componentsLoading, loadComponents, page, selectedAppId]);

  useEffect(() => {
    if (!worksLoaded) {
      void refreshWorks();
    }
  }, [refreshWorks, worksLoaded]);

  const homeDisplayApps = visibleHomeApps;
  const managementApps = libraryLoaded ? libraryApps : homeApps;
  const detailApps = libraryLoaded ? libraryApps : homeApps;
  const homeSyncActive = productHomeLoading || homeRevealPendingCount > 0;
  const discoverSyncActive = libraryLoading || discoverRevealPendingCount > 0;
  const loading = nativeLoading || productHomeLoading || libraryLoading || componentsLoading;
  const homeInitialLoading = nativeLoading && nativeApps.length === 0 && visibleHomeApps.length === 0;
  const loadError = [
    nativeLoadError,
    productHomeLoadError,
    page === 'manage' ? libraryLoadError : null,
    page === 'component-center' ? componentsLoadError : null,
  ].filter(Boolean).join('\n') || null;

  const launchQuery = normalized(launchSearch);
  const manageQuery = normalized(manageSearch);
  const componentQuery = normalized(componentSearch);
  const appsById = useMemo(() => new Map(detailApps.map((app) => [app.id, app])), [detailApps]);
  const runningSurfaceAppIdSet = useMemo(
    () => new Set(runningProductAppRuntimeIds),
    [runningProductAppRuntimeIds],
  );

  const launchNativeApps = useMemo(() => nativeApps
    .filter((app) => appMatchesSearch(app, launchQuery)), [launchQuery, nativeApps]);

  const launchApps = useMemo(() => homeDisplayApps
    .filter((app) => app.installed === true)
    .filter((app) => app.enabled)
    .filter((app) => !appHasCatalogIssues(app))
    .filter((app) => app.catalogVisibility !== 'hidden')
    .filter((app) => appMatchesSearch(app, launchQuery)), [homeDisplayApps, launchQuery]);

  const launchCardCount = launchNativeApps.length + launchApps.length;

  const discoverApps = useMemo(() => visibleDiscoverApps
    .filter((app) => appMatchesSearch(app, launchQuery)), [launchQuery, visibleDiscoverApps]);
  const showDiscoverPanel = discoverSyncActive || discoverApps.length > 0;

  const manageApps = useMemo(() => {
    const filtered = managementApps
      .filter((app) => filterProductApp(app, productAppFilter))
      .filter((app) => appMatchesSearch(app, manageQuery));
    return sortManageApps(filtered, manageSort, runningSurfaceAppIdSet);
  }, [managementApps, manageQuery, productAppFilter, manageSort, runningSurfaceAppIdSet]);

  const continueWorks = useMemo(() => works
    .filter((work) => OPEN_WORK_STATUSES.has(work.status))
    .map((work) => ({ work, appRef: appRefFromWork(work) }))
    .filter((item): item is { work: WorkRecord; appRef: WorkAppRef } => Boolean(item.appRef))
    .filter((item) => {
      const nativeApp = nativeApps.find((candidate) => sameAppRef(nativeAppWorkRef(candidate.id), item.appRef));
      if (nativeApp) {
        return nativeAppSupportsMultipleWorks(nativeApp)
          && workMatchesSearch(item.work, nativeApp.name, launchQuery);
      }
      const app = homeDisplayApps.find((candidate) => sameProductAppRef(productAppWorkRef(candidate), item.appRef));
      return Boolean(app)
        && app?.installed === true
        && !appHasCatalogIssues(app)
        && getCatalogAppLaunchBehavior(app).supportsMultipleWorks
        && workMatchesSearch(item.work, app?.name, launchQuery);
    })
    .sort((left, right) => right.work.updatedAt - left.work.updatedAt), [homeDisplayApps, launchQuery, nativeApps, works]);

  const filteredComponents = useMemo(() => components
    .filter((component) => componentFilter === 'all' || component.kind === componentFilter)
    .filter((component) => componentMatchesSearch(component, componentQuery)), [componentFilter, components, componentQuery]);

  const selectedApp = selectedAppId ? appsById.get(selectedAppId) ?? null : null;
  const selectedNativeApp = selectedAppKind === 'native' && selectedAppId
    ? nativeApps.find((app) => app.id === selectedAppId) ?? null
    : null;
  const selectedAppComponents = useMemo(
    () => selectedApp ? resolveAppComponents(selectedApp, components) : [],
    [components, selectedApp],
  );

  const selectedComponent = selectedComponentId
    ? components.find((component) => component.id === selectedComponentId) ?? null
    : null;

  const continueWorksByAppId = useMemo(() => {
    const byApp = new Map<string, Array<{ work: WorkRecord; appRef: WorkAppRef }>>();
    for (const item of continueWorks) {
      const app = homeDisplayApps.find((candidate) => sameProductAppRef(productAppWorkRef(candidate), item.appRef));
      if (!app) continue;
      const current = byApp.get(app.id) ?? [];
      current.push(item);
      byApp.set(app.id, current);
    }
    return byApp;
  }, [homeDisplayApps, continueWorks]);

  const continueWorksByNativeAppId = useMemo(() => {
    const byApp = new Map<string, Array<{ work: WorkRecord; appRef: WorkAppRef }>>();
    for (const item of continueWorks) {
      const app = nativeApps.find((candidate) => sameAppRef(nativeAppWorkRef(candidate.id), item.appRef));
      if (!app) continue;
      const current = byApp.get(app.id) ?? [];
      current.push(item);
      byApp.set(app.id, current);
    }
    return byApp;
  }, [continueWorks, nativeApps]);

  const handleLaunchApp = useCallback(async (app: ProductAppCatalogEntry) => {
    if (app.installed !== true) {
      notificationService.error(t('productSystem.messages.installBeforeLaunch', { name: app.name }));
      return;
    }
    setLaunchingAppId(app.id);
    try {
      if (
        app.launch?.kind === 'applicationSurface'
        || app.launch?.kind === 'agentSession'
        || app.launch?.kind === 'appStudio'
      ) {
        if (catalogAppRequiresWorkspace(app)) {
          setWorkspaceLaunchApp(app);
          return;
        }
        await launchWorkForChoice({
          agentChoice: productAppWorkChoice(app.id),
          workspace: lastUsedWorkspace ?? null,
          rememberWorkspace,
          title: app.name,
          objective: app.goal || app.description || app.name,
        });
        return;
      }
      notificationService.error(t('productSystem.messages.noLaunch', { name: app.name }));
    } catch (error) {
      log.error('Failed to launch Product App', { appId: app.id, error });
      notificationService.error(t('productSystem.messages.launchFailed', {
        name: app.name,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setLaunchingAppId(null);
    }
  }, [lastUsedWorkspace, rememberWorkspace, t]);

  const handleLaunchNativeApp = useCallback(async (app: NativeAppCatalogEntry) => {
    setLaunchingAppId(app.id);
    try {
      if (app.launch?.kind === 'agentSession' || app.launch?.kind === 'appStudio') {
        const agentChoice = nativeAgentChoiceForApp(app);
        if (!agentChoice) {
          notificationService.error(t('productSystem.messages.noLaunch', { name: app.name }));
          return;
        }
        await launchWorkForChoice({
          agentChoice,
          workspace: lastUsedWorkspace ?? null,
          rememberWorkspace,
          title: app.name,
          objective: app.goal || app.description || app.name,
          appRef: nativeAppWorkRef(app.id),
          workResolutionMode: getCatalogAppLaunchBehavior(app).workResolutionMode,
        });
        return;
      }
      notificationService.error(t('productSystem.messages.noLaunch', { name: app.name }));
    } catch (error) {
      log.error('Failed to launch native app', { appId: app.id, error });
      notificationService.error(t('productSystem.messages.launchFailed', {
        name: app.name,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setLaunchingAppId(null);
    }
  }, [lastUsedWorkspace, rememberWorkspace, t]);

  const handleStopApp = useCallback(async (app: ProductAppCatalogEntry) => {
    setStoppingAppId(app.id);
    try {
      await productAppRuntimeHostAPI.stopWorker(app.id);
      markProductAppRuntimeWorkerStopped(app.id);
      notificationService.success(t('productSystem.messages.stopped', { name: app.name }), { duration: 2200 });
    } catch (error) {
      log.error('Failed to stop Product App worker', { appId: app.id, error });
      notificationService.error(t('productSystem.messages.stopFailed', {
        name: app.name,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setStoppingAppId(null);
    }
  }, [markProductAppRuntimeWorkerStopped, t]);

  const handleCloseResumeWork = useCallback(async (work: WorkRecord) => {
    setClosingResumeWorkId(work.id);
    try {
      await controlWork({ workId: work.id, action: 'archive' });
    } catch (error) {
      log.error('Failed to close resume work from App Center', { workId: work.id, error });
      notificationService.error(t('productSystem.messages.closeWorkFailed', {
        name: work.title,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setClosingResumeWorkId((current) => (current === work.id ? null : current));
    }
  }, [controlWork, t]);

  const handleSetProductAppEnabled = useCallback(async (
    app: ProductAppCatalogEntry,
    enabled: boolean,
  ) => {
    setManagingAppId(app.id);
    try {
      await appCatalogAPI.setProductAppEnabled(app, enabled);
      await loadCatalog({ force: true });
      notificationService.success(
        t(enabled ? 'productSystem.manage.enabledToast' : 'productSystem.manage.disabledToast', {
          name: app.name,
        }),
        { duration: 2200 },
      );
    } catch (error) {
      log.error('Failed to update Product App enabled state', { appId: app.id, enabled, error });
      notificationService.error(t('productSystem.manage.updateFailed', {
        name: app.name,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setManagingAppId(null);
    }
  }, [loadCatalog, t]);

  const handleInstallProductApp = useCallback(async (app: ProductAppCatalogEntry) => {
    setManagingAppId(app.id);
    try {
      await appCatalogAPI.installProductApp(app);
      await loadCatalog({ force: true });
      notificationService.success(
        t(app.updateAvailable === true
          ? 'productSystem.manage.updatedToast'
          : 'productSystem.manage.installedToast', { name: app.name }),
        { duration: 2600 },
      );
    } catch (error) {
      log.error('Failed to install Product App', { appId: app.id, error });
      notificationService.error(t(app.updateAvailable === true
        ? 'productSystem.manage.updateFailed'
        : 'productSystem.manage.installFailed', {
        name: app.name,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setManagingAppId(null);
    }
  }, [loadCatalog, t]);

  const handleUninstallProductApp = useCallback(async (app: ProductAppCatalogEntry) => {
    setManagingAppId(app.id);
    try {
      await appCatalogAPI.uninstallProductApp(app);
      await loadCatalog({ force: true });
      notificationService.success(
        t('productSystem.manage.uninstalledToast', { name: app.name }),
        { duration: 3000 },
      );
    } catch (error) {
      log.error('Failed to uninstall Product App', { appId: app.id, error });
      notificationService.error(t('productSystem.manage.uninstallFailed', {
        name: app.name,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setManagingAppId(null);
    }
  }, [loadCatalog, t]);

  const toggleCardFlip = useCallback((appId: string) => {
    setFlippedAppId((current) => (current === appId ? null : appId));
  }, []);

  const handleOpenAppStudio = useCallback(async () => {
    const appStudio = nativeApps.find((app) => app.id === 'app-studio') ?? null;
    if (!appStudio) {
      notificationService.error(t('productSystem.messages.noLaunch', { name: 'App Studio' }));
      return;
    }
    await handleLaunchNativeApp(appStudio);
  }, [handleLaunchNativeApp, nativeApps, t]);

  const workspaceLaunchDialog = (
    <NewWorkDialog
      open={Boolean(workspaceLaunchApp)}
      onClose={() => setWorkspaceLaunchApp(null)}
      initialAgentChoice={workspaceLaunchApp ? productAppWorkChoice(workspaceLaunchApp.id) : undefined}
      initialScopeRequirement={workspaceLaunchApp?.launch?.scopeRequirement}
    />
  );

  const appDetailDialog = selectedAppId && (selectedApp || selectedNativeApp) ? (() => {
    const detailApp = selectedNativeApp ?? selectedApp!;

    return (
      <AppDetailScene
        appKind={selectedAppKind ?? 'product'}
        app={detailApp}
        components={selectedApp ? selectedAppComponents : []}
        works={works}
        onBack={closeAppDetail}
        onLaunch={() => {
          if (selectedNativeApp) {
            void handleLaunchNativeApp(selectedNativeApp);
            return;
          }
          void handleLaunchApp(selectedApp!);
        }}
        onStop={() => void handleStopApp(selectedApp!)}
        running={selectedApp ? runningSurfaceAppIdSet.has(selectedApp.id) : false}
        stopping={selectedApp ? stoppingAppId === selectedApp.id : false}
        onOpenWork={(work) => {
          closeAppDetail();
          void openWork(work);
        }}
        onOpenComponent={(componentId) => {
          closeAppDetail();
          openComponentCenter(componentId);
        }}
        managing={selectedApp ? managingAppId === selectedApp.id : false}
        onInstall={() => selectedApp && void handleInstallProductApp(selectedApp)}
      />
    );
  })() : null;

  if (page === 'component-center') {
    return (
      <>
        <ComponentCenter
          components={filteredComponents}
          allComponents={components}
          activeFilter={componentFilter}
          selectedComponent={selectedComponent}
          workspacePath={lastUsedWorkspace?.rootPath ?? null}
          loading={componentsLoading}
          query={componentSearch}
          currentMode={modeForPage(page)}
          onModeChange={(mode) => {
            if (mode === 'home') openHome();
            if (mode === 'manage') openManage();
            if (mode === 'component-center') openComponentCenter();
          }}
          onSearch={setComponentSearch}
          onRefresh={() => void loadComponents({ force: true })}
          onFilter={setComponentFilter}
          onSelect={(component) => openComponentCenter(component.id)}
          onClearSelection={() => openComponentCenter(null)}
          onCreateComponent={handleOpenAppStudio}
          t={t}
        />
        {appDetailDialog}
        {workspaceLaunchDialog}
      </>
    );
  }

  if (page === 'manage') {
    return (
      <>
        <AppManagementCenter
          apps={manageApps}
          allApps={managementApps}
          activeFilter={productAppFilter}
          query={manageSearch}
          currentMode={modeForPage(page)}
          loading={libraryLoading}
          managingAppId={managingAppId}
          runningAppIds={runningSurfaceAppIdSet}
          sortKey={manageSort}
          onModeChange={(mode) => {
            if (mode === 'home') openHome();
            if (mode === 'manage') openManage();
            if (mode === 'component-center') openComponentCenter();
          }}
          onSearch={setManageSearch}
          onFilter={setProductAppFilter}
          onSort={setManageSort}
          onRefresh={() => {
            void Promise.allSettled([
              loadProductAppLibrary({ force: true }),
              loadProductHomeCatalog({ force: true }),
            ]);
          }}
          onOpenDetails={(app) => openAppDetail(app.id)}
          onInstall={(app) => void handleInstallProductApp(app)}
          onSetEnabled={(app, enabled) => void handleSetProductAppEnabled(app, enabled)}
          onUninstall={(app) => void handleUninstallProductApp(app)}
          onCreateApp={handleOpenAppStudio}
          t={t}
        />
        {appDetailDialog}
        {workspaceLaunchDialog}
      </>
    );
  }

  return (
    <>
      <Scene className="apps-scene product-apps-scene" data-testid="apps-scene">
        <AppCenterModeNav
          currentMode={modeForPage(page)}
          onChange={(mode) => {
            if (mode === 'home') openHome();
            if (mode === 'manage') openManage();
            if (mode === 'component-center') openComponentCenter();
          }}
          actions={(
            <IconButton
              aria-label={t('productSystem.actions.refresh')}
              tooltip={t('productSystem.actions.refresh')}
              variant="ghost"
              size="small"
              onClick={() => void loadCatalog({ force: true })}
              disabled={loading}
            >
              <RefreshCw size={14} aria-hidden />
            </IconButton>
          )}
          t={t}
        />

        <SearchToolbar
          className="apps-scene__search-toolbar apps-scene__launch-ribbon"
          density="compact"
          aria-label={t('productSystem.searchLabel')}
          search={{
            value: launchSearch,
            onChange: setLaunchSearch,
            placeholder: t('productSystem.launch.searchPlaceholder'),
            size: 'medium',
            shape: 'pill',
            inputAriaLabel: t('productSystem.searchLabel'),
          }}
          actions={(
            <div className="apps-scene__header-actions apps-scene__launch-actions">
              <Button variant="primary" size="small" onClick={() => void handleOpenAppStudio()}>
                <Plus size={14} aria-hidden />
                <span>{t('productSystem.actions.createApp')}</span>
              </Button>
            </div>
          )}
        >
          <div
            className={`apps-scene__inline-resume${continueWorks.length ? '' : ' is-empty'}`}
            role="group"
            aria-label={t('productSystem.continue.title')}
          >
            <div className="apps-scene__inline-resume-label">
              <BriefcaseBusiness size={14} aria-hidden />
              <span
                className="apps-scene__inline-resume-count"
                aria-label={t('productSystem.continue.count', { count: continueWorks.length })}
              >
                {continueWorks.length}
              </span>
            </div>
            {continueWorks.length ? (
              <div className="apps-scene__inline-resume-items">
                {continueWorks.map(({ work, appRef }) => {
                  const nativeApp = nativeApps.find((candidate) => sameAppRef(nativeAppWorkRef(candidate.id), appRef));
                  const app = nativeApp
                    ?? homeDisplayApps.find((candidate) => sameProductAppRef(productAppWorkRef(candidate), appRef));
                  return (
                    <WorkResumeCard
                      key={work.id}
                      work={work}
                      app={app}
                      appName={app?.name ?? appRef.appId}
                      onOpen={() => void openWork(work)}
                      onClose={() => void handleCloseResumeWork(work)}
                      closing={closingResumeWorkId === work.id}
                      t={t}
                    />
                  );
                })}
              </div>
            ) : (
              <span className="apps-scene__inline-resume-empty">{t('productSystem.continue.emptyTitle')}</span>
            )}
            {continueWorks.length ? (
              <Button className="apps-scene__inline-resume-all" variant="ghost" size="small" onClick={openWorkCenterHome}>
                {t('productSystem.continue.viewAll')}
              </Button>
            ) : null}
          </div>
        </SearchToolbar>

      {loadError ? (
        <div className="apps-scene__error">
          <span>{loadError}</span>
          <Button size="small" variant="secondary" onClick={() => void loadCatalog({ force: true })}>
            {t('productSystem.actions.retry')}
          </Button>
        </div>
      ) : null}

      {homeInitialLoading ? (
        <div className="apps-scene__loading">
          <DotMatrixLoader size="small" />
          <span>{t('productSystem.loading')}</span>
        </div>
      ) : (
        <SceneBody className="apps-scene__launch-layout">
          <div className="apps-scene__launch-column">
            <Panel className="apps-scene__apps-panel apps-scene__home-section apps-scene__home-section--my-apps">
              <PanelHeader
                title={t('productSystem.myApps.title')}
                actions={(
                  <div className="apps-scene__panel-badges">
                    <Badge variant="neutral">
                      {t('productSystem.myApps.count', { count: launchCardCount })}
                    </Badge>
                    {homeSyncActive ? (
                      <Badge variant="info">
                        {homeRevealPendingCount > 0
                          ? t('productSystem.myApps.syncingRemaining', { count: homeRevealPendingCount })
                          : t('productSystem.myApps.syncing')}
                      </Badge>
                    ) : null}
                  </div>
                )}
              />
              <PanelBody>
                {launchCardCount || homeSyncActive ? (
                  <div className="apps-scene__app-grid">
                    {launchNativeApps.map((app) => (
                      <NativeAppCard
                        key={app.id}
                        app={app}
                        launching={launchingAppId === app.id}
                        supportsMultipleWorks={nativeAppSupportsMultipleWorks(app)}
                        relatedWorks={nativeAppSupportsMultipleWorks(app)
                          ? continueWorksByNativeAppId.get(app.id)?.map(({ work }) => work) ?? []
                          : []}
                        flipped={flippedAppId === app.id}
                        onToggleFlip={() => toggleCardFlip(app.id)}
                        onLaunch={() => void handleLaunchNativeApp(app)}
                        onContinue={(work) => void openWork(work)}
                        onOpenDetails={() => openAppDetail(app.id, 'native')}
                        t={t}
                      />
                    ))}
                    {launchApps.map((app) => {
                      const launchBehavior = getCatalogAppLaunchBehavior(app);
                      return (
                        <ProductAppCard
                          key={productAppLibraryKey(app)}
                          app={app}
                          launching={launchingAppId === app.id}
                          stopping={stoppingAppId === app.id}
                          running={runningSurfaceAppIdSet.has(app.id)}
                          supportsMultipleWorks={launchBehavior.supportsMultipleWorks}
                          relatedWorks={launchBehavior.supportsMultipleWorks
                            ? continueWorksByAppId.get(app.id)?.map(({ work }) => work) ?? []
                            : []}
                          flipped={flippedAppId === app.id}
                          onToggleFlip={() => toggleCardFlip(app.id)}
                          onLaunch={() => void handleLaunchApp(app)}
                          onStop={() => void handleStopApp(app)}
                          onContinue={(work) => void openWork(work)}
                          onOpenDetails={() => openAppDetail(app.id)}
                          appearing
                          t={t}
                        />
                      );
                    })}
                    {homeSyncActive ? (
                      <CatalogGhostCard
                        label={t('productSystem.myApps.loadingProductApps')}
                        detail={homeRevealPendingCount > 0
                          ? t('productSystem.myApps.revealingProductAppsDetail', { count: homeRevealPendingCount })
                          : t('productSystem.myApps.loadingProductAppsDetail')}
                      />
                    ) : null}
                  </div>
                ) : (
                  <EmptyState
                    imageSize="small"
                    title={t('productSystem.myApps.emptyTitle')}
                    description={t('productSystem.myApps.emptyDescription')}
                  />
                )}
              </PanelBody>
            </Panel>

            {showDiscoverPanel ? (
              <Panel className="apps-scene__apps-panel apps-scene__discover-panel apps-scene__home-section apps-scene__home-section--discover">
                <PanelHeader
                  title={t('productSystem.discover.title')}
                  actions={(
                    <Badge variant={discoverSyncActive ? 'info' : 'neutral'}>
                      {discoverSyncActive
                        ? discoverRevealPendingCount > 0
                          ? t('productSystem.discover.syncingRemaining', { count: discoverRevealPendingCount })
                          : t('productSystem.discover.loadingBadge')
                        : t('productSystem.discover.count', { count: discoverApps.length })}
                    </Badge>
                  )}
                />
                <PanelBody>
                  <div className="apps-scene__app-grid">
                    {discoverApps.map((app) => (
                      <DiscoverAppCard
                        key={productAppLibraryKey(app)}
                        app={app}
                        installing={managingAppId === app.id}
                        onInstall={() => void handleInstallProductApp(app)}
                        onOpenDetails={() => openAppDetail(app.id)}
                        appearing
                        t={t}
                      />
                    ))}
                    {discoverSyncActive ? (
                      <CatalogGhostCard
                        label={t('productSystem.discover.loading')}
                        detail={discoverRevealPendingCount > 0
                          ? t('productSystem.discover.revealingDetail', { count: discoverRevealPendingCount })
                          : t('productSystem.discover.loadingDetail')}
                      />
                    ) : null}
                  </div>
                </PanelBody>
              </Panel>
            ) : null}
          </div>
        </SceneBody>
      )}
      </Scene>
      {appDetailDialog}
      {workspaceLaunchDialog}
    </>
  );
};

function CatalogGhostCard({
  label,
  detail,
}: {
  label: string;
  detail: string;
}) {
  return (
    <div className="apps-scene__ghost-card" role="status" aria-live="polite">
      <div className="apps-scene__ghost-card-icon">
        <DotMatrixLoader size="small" />
      </div>
      <div className="apps-scene__ghost-card-copy">
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      <div className="apps-scene__ghost-card-lines" aria-hidden="true">
        <span />
        <span />
      </div>
    </div>
  );
}

function AppManagementCenter({
  apps,
  allApps,
  activeFilter,
  query,
  currentMode,
  loading,
  managingAppId,
  runningAppIds,
  sortKey,
  onModeChange,
  onSearch,
  onFilter,
  onSort,
  onRefresh,
  onOpenDetails,
  onInstall,
  onSetEnabled,
  onUninstall,
  onCreateApp,
  t,
}: {
  apps: ProductAppCatalogEntry[];
  allApps: ProductAppCatalogEntry[];
  activeFilter: ProductAppFilter;
  query: string;
  currentMode: AppCenterMode;
  loading: boolean;
  managingAppId: string | null;
  runningAppIds: Set<string>;
  sortKey: ManageSortKey;
  onModeChange: (mode: AppCenterMode) => void;
  onSearch: (value: string) => void;
  onFilter: (filter: ProductAppFilter) => void;
  onSort: (sort: ManageSortKey) => void;
  onRefresh: () => void;
  onOpenDetails: (app: ProductAppCatalogEntry) => void;
  onInstall: (app: ProductAppCatalogEntry) => void;
  onSetEnabled: (app: ProductAppCatalogEntry, enabled: boolean) => void;
  onUninstall: (app: ProductAppCatalogEntry) => void;
  onCreateApp: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [viewMode, setViewMode] = useState<ManageViewMode>('cards');

  return (
    <Scene className="apps-scene apps-scene--manage" data-testid="apps-manage-scene">
      <AppCenterModeNav
        currentMode={currentMode}
        onChange={onModeChange}
        t={t}
        actions={(
          <div className="apps-scene__header-actions">
            <IconButton
              aria-label={t('productSystem.actions.refresh')}
              tooltip={t('productSystem.actions.refresh')}
              variant="ghost"
              size="small"
              onClick={onRefresh}
              disabled={loading}
            >
              <RefreshCw size={14} aria-hidden />
            </IconButton>
            <Button variant="primary" size="small" onClick={onCreateApp}>
              <Plus size={14} aria-hidden />
              <span>{t('productSystem.actions.createApp')}</span>
            </Button>
          </div>
        )}
      />

      <SceneBody className="apps-scene__manage-layout">
        <aside className="apps-scene__manage-categories" aria-label={t('productSystem.manage.categoriesLabel')}>
          <h2 className="apps-scene__manage-categories-title">{t('productSystem.manage.categoriesLabel')}</h2>
          <nav className="apps-scene__manage-category-nav" role="navigation">
            {PRODUCT_FILTERS.map((filter) => {
              const count = allApps.filter((app) => filterProductApp(app, filter)).length;
              return (
                <button
                  key={filter}
                  type="button"
                  className={`apps-scene__manage-category${activeFilter === filter ? ' is-active' : ''}`}
                  aria-current={activeFilter === filter ? 'page' : undefined}
                  onClick={() => onFilter(filter)}
                >
                  <span className="apps-scene__manage-category-label">
                    {t(`productSystem.filters.${filter}`)}
                  </span>
                  <span className="apps-scene__manage-category-count">{count}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="apps-scene__manage-content">
          <SearchToolbar
            className="apps-scene__search-toolbar"
            density="compact"
            aria-label={t('productSystem.manage.searchLabel')}
            search={{
              value: query,
              onChange: onSearch,
              placeholder: t('productSystem.manage.searchPlaceholder'),
              size: 'medium',
              inputAriaLabel: t('productSystem.manage.searchLabel'),
            }}
            actions={<ManageViewToggle viewMode={viewMode} onChange={setViewMode} t={t} />}
          />

          <div className="apps-scene__manage-sort" role="group" aria-label={t('productSystem.manage.sortLabel')}>
            <span className="apps-scene__manage-sort-label">{t('productSystem.manage.sortBy')}</span>
            <SegmentedControl
              value={sortKey}
              onChange={(value) => onSort(value as ManageSortKey)}
              size="small"
              ariaLabel={t('productSystem.manage.sortLabel')}
              options={MANAGE_SORT_KEYS.map((key) => ({
                value: key,
                label: t(`productSystem.manage.sortOptions.${key}`),
              }))}
            />
          </div>

          {loading && !apps.length ? (
            <div className="apps-scene__loading apps-scene__loading--inline">
              <DotMatrixLoader size="small" />
              <span>{t('productSystem.loading')}</span>
            </div>
          ) : apps.length ? (
            <ManagementList
              apps={apps}
              viewMode={viewMode}
              managingAppId={managingAppId}
              runningAppIds={runningAppIds}
              onInstall={onInstall}
              onSetEnabled={onSetEnabled}
              onUninstall={onUninstall}
              onOpenDetails={onOpenDetails}
              t={t}
            />
          ) : (
            <EmptyState
              imageSize="small"
              title={t('productSystem.manage.emptyTitle')}
              description={t('productSystem.manage.emptyDescription')}
            />
          )}
        </div>
      </SceneBody>
    </Scene>
  );
}

function WorkResumeCard({
  work,
  app,
  appName,
  onOpen,
  onClose,
  closing,
  t,
}: {
  work: WorkRecord;
  app?: AppDisplayEntry | null;
  appName: string;
  onOpen: () => void;
  onClose: () => void;
  closing: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const statusLabel = t(`productSystem.status.${work.status}`, { defaultValue: work.status });
  const label = `${work.title}, ${appName}, ${statusLabel}`;
  const closeLabel = t('productSystem.continue.closeWork', { title: work.title });
  const iconApp = app ?? {
    id: work.id,
    name: appName,
    icon: { kind: 'monogram' as const, label: appName },
  };

  return (
    <span
      className="apps-scene__resume-chip"
      role="group"
      aria-label={label}
    >
      <button
        type="button"
        className="apps-scene__resume-chip-open"
        onClick={onOpen}
        aria-label={label}
      >
        <span
          className={[
            'apps-scene__resume-chip-icon',
            isAssetIcon(iconApp.icon) && 'apps-scene__resume-chip-icon--logo',
          ].filter(Boolean).join(' ')}
          aria-hidden
        >
          <AppIcon app={iconApp} size={22} />
          <StatusDot
            className="apps-scene__resume-chip-status"
            tone={statusVariant(work.status)}
            size="small"
            pulse={work.status === 'running'}
          />
        </span>
        <span className="apps-scene__resume-chip-main">
          <strong>{work.title}</strong>
        </span>
      </button>
      <IconButton
        className="apps-scene__resume-chip-close"
        size="xs"
        variant="ghost"
        shape="circle"
        aria-label={closeLabel}
        tooltip={closeLabel}
        disabled={closing}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
      >
        <X size={12} aria-hidden />
      </IconButton>
    </span>
  );
}

function NativeAppCard({
  app,
  launching,
  supportsMultipleWorks,
  relatedWorks,
  flipped,
  onToggleFlip,
  onLaunch,
  onContinue,
  onOpenDetails,
  t,
}: {
  app: NativeAppCatalogEntry;
  launching: boolean;
  supportsMultipleWorks: boolean;
  relatedWorks: WorkRecord[];
  flipped: boolean;
  onToggleFlip: () => void;
  onLaunch: () => void;
  onContinue: (work: WorkRecord) => void;
  onOpenDetails: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const hasStack = supportsMultipleWorks && relatedWorks.length > 0;
  const isExpanded = hasStack && flipped;

  return (
    <WorkCardFrame depth={hasStack ? Math.min(relatedWorks.length, 2) : 0} expanded={isExpanded}>
      <ItemCard
        className="apps-scene__app-card"
        interactive={!isExpanded}
        onActivate={isExpanded ? undefined : onOpenDetails}
        aria-label={app.name}
        data-testid="native-app-home-card"
        data-app-id={app.id}
        data-app-kind="native_app"
      >
        <CardExpandPanel
          expanded={isExpanded}
          onCollapse={onToggleFlip}
          front={(
            <>
              <ItemCardTop className="apps-scene__app-card-top">
                <WorkStack
                  app={app}
                  size={40}
                  running={false}
                  relatedWorks={relatedWorks}
                  clickable={hasStack}
                  onContinue={onContinue}
                  t={t}
                />
                <ItemCardTitle className="apps-scene__app-card-title">
                  <span>{app.name}</span>
                </ItemCardTitle>
                <CardPrimaryAction
                  supportsMultipleWorks={supportsMultipleWorks}
                  running={false}
                  launching={launching}
                  stopping={false}
                  onLaunch={onLaunch}
                  onStop={() => {}}
                  t={t}
                />
              </ItemCardTop>
              <p
                className={[
                  'apps-scene__app-card-description',
                  hasStack && 'apps-scene__app-card-description--compact',
                ].filter(Boolean).join(' ')}
              >
                {app.goal || app.description}
              </p>
              {hasStack ? (
                <CardStackLink count={relatedWorks.length} onClick={onToggleFlip} t={t} />
              ) : null}
            </>
          )}
          back={hasStack ? (
            <WorkCardBack
              appLabel={app.name}
              app={app}
              relatedWorks={relatedWorks}
              onBack={onToggleFlip}
              onSelect={onContinue}
              onCreateNew={onLaunch}
              t={t}
            />
          ) : null}
        />
      </ItemCard>
    </WorkCardFrame>
  );
}

function DiscoverAppCard({
  app,
  installing,
  appearing,
  onInstall,
  onOpenDetails,
  t,
}: {
  app: ProductAppCatalogEntry;
  installing: boolean;
  appearing?: boolean;
  onInstall: () => void;
  onOpenDetails: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <ItemCard
      className={[
        'apps-scene__app-card',
        'apps-scene__app-card--discover',
        appearing && 'apps-scene__app-card--appearing',
      ].filter(Boolean).join(' ')}
      onActivate={onOpenDetails}
      aria-label={app.name}
      data-testid="product-app-discover-card"
      data-app-id={app.id}
      >
      <ItemCardTop className="apps-scene__app-card-top">
        <span
          className={[
            'apps-scene__discover-icon',
            isAssetIcon(app.icon) && 'apps-scene__discover-icon--logo',
          ].filter(Boolean).join(' ')}
          aria-hidden
        >
          <AppIcon app={app} size={40} />
        </span>
        <ItemCardTitle className="apps-scene__app-card-title">
          <span>{app.name}</span>
        </ItemCardTitle>
        <IconButton
          variant="ghost"
          size="small"
          shape="circle"
          className="apps-scene__discover-install"
          aria-label={t('productSystem.manage.install')}
          tooltip={t('productSystem.manage.install')}
          onClick={(event) => { event.stopPropagation(); onInstall(); }}
          disabled={installing}
          aria-busy={installing || undefined}
        >
          <Download size={14} aria-hidden />
        </IconButton>
      </ItemCardTop>
      <p className="apps-scene__app-card-description">{app.goal || app.description}</p>
    </ItemCard>
  );
}

function ProductAppCard({
  app,
  launching,
  stopping,
  running,
  supportsMultipleWorks,
  relatedWorks,
  flipped,
  appearing,
  onToggleFlip,
  onLaunch,
  onStop,
  onContinue,
  onOpenDetails,
  t,
}: {
  app: ProductAppCatalogEntry;
  launching: boolean;
  stopping: boolean;
  running: boolean;
  supportsMultipleWorks: boolean;
  relatedWorks: WorkRecord[];
  flipped: boolean;
  appearing?: boolean;
  onToggleFlip: () => void;
  onLaunch: () => void;
  onStop: () => void;
  onContinue: (work: WorkRecord) => void;
  onOpenDetails: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const hasStack = supportsMultipleWorks && relatedWorks.length > 0;
  const isExpanded = hasStack && flipped;

  return (
    <WorkCardFrame
      depth={hasStack ? Math.min(relatedWorks.length, 2) : 0}
      expanded={isExpanded}
      className={appearing ? 'apps-scene__app-card--appearing' : undefined}
    >
      <ItemCard
        className="apps-scene__app-card"
        interactive={!isExpanded}
        onActivate={isExpanded ? undefined : onOpenDetails}
        aria-label={app.name}
        data-testid="product-app-home-card"
        data-app-id={app.id}
        data-app-kind="product_app"
        data-component-count={(app.components ?? []).length}
      >
        <CardExpandPanel
          expanded={isExpanded}
          onCollapse={onToggleFlip}
          front={(
            <>
              <ItemCardTop className="apps-scene__app-card-top">
                <WorkStack
                  app={app}
                  size={40}
                  running={running}
                  relatedWorks={relatedWorks}
                  clickable={hasStack}
                  onContinue={onContinue}
                  t={t}
                />
                <ItemCardTitle className="apps-scene__app-card-title">
                  <span>{app.name}</span>
                </ItemCardTitle>
                <CardPrimaryAction
                  supportsMultipleWorks={supportsMultipleWorks}
                  running={running}
                  launching={launching}
                  stopping={stopping}
                  onLaunch={onLaunch}
                  onStop={onStop}
                  t={t}
                />
              </ItemCardTop>
              <p
                className={[
                  'apps-scene__app-card-description',
                  hasStack && 'apps-scene__app-card-description--compact',
                ].filter(Boolean).join(' ')}
              >
                {app.goal || app.description}
              </p>
              {hasStack ? (
                <CardStackLink count={relatedWorks.length} onClick={onToggleFlip} t={t} />
              ) : null}
            </>
          )}
          back={hasStack ? (
            <WorkCardBack
              appLabel={app.name}
              app={app}
              relatedWorks={relatedWorks}
              onBack={onToggleFlip}
              onSelect={onContinue}
              onCreateNew={onLaunch}
              t={t}
            />
          ) : null}
        />
      </ItemCard>
    </WorkCardFrame>
  );
}

export default AppsScene;
