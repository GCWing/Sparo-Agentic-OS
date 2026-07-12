import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Blocks,
  CircleOff,
  Download,
  FilePenLine,
  Library,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
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
  Dialog,
  DialogBody,
  DialogFooter,
  EmptyState,
  IconButton,
  ItemCard,
  ItemCardTitle,
  ItemCardTop,
  Scene,
  SceneBody,
  SearchToolbar,
  SegmentedControl,
  StatusDot,
  TabPane,
  Tabs,
} from '@/design-system';
import {
  appCatalogAPI,
  localizeCatalogApps,
  type AppAuthor,
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
import {
  useAppsStore,
  type AppCenterView,
  type ManageSection,
  type ManageSortKey,
} from './appsStore';
import { AppDetailScene } from './app-detail/AppDetailScene';
import './app-detail/AppDetailScene.scss';
import { useProductAppRuntimeStore } from './product-app-runtime/productAppRuntimeStore';
import { productAppRuntimeHostAPI } from '@/infrastructure/api/service-api/ProductAppRuntimeHostAPI';
import { mergeProductAppLibrary, productAppLibraryKey } from './productAppLibrary';
import { AppIcon } from './AppIcon';
import { launchActiveIntelligentApp } from './intelligentAppLaunchService';
import { createAndOpenAppBuilder, openAppBuilderSession } from './app-builder/openAppBuilderSession';
import { appScopeFromWorkspace, systemAppScope } from '@/shared/types/app-scope';
import {
  intelligentAppAPI,
  type AppDraftRecord,
  type AppReleaseCapabilityReview,
  type IntelligentAppCatalog,
} from '@/infrastructure/api/service-api/IntelligentAppAPI';
import './AppsScene.scss';

const log = createLogger('AppsScene');

const MANAGE_SECTIONS: ManageSection[] = [
  'apps',
  'updates',
  'disabled',
  'creations',
  'drafts',
  'components',
];

const MANAGE_CATEGORY_ICONS = {
  apps: Library,
  updates: RefreshCw,
  disabled: CircleOff,
  creations: Sparkles,
  drafts: FilePenLine,
  components: Blocks,
} as const;

const MANAGE_SORT_KEYS: ManageSortKey[] = ['attention', 'name', 'status'];
const HOME_APP_FIRST_REVEAL_DELAY_MS = 40;
const HOME_APP_REVEAL_INTERVAL_MS = 120;
const HOME_ACTIVITY_LIMIT = 6;
const PINNED_SYSTEM_APP_ORDER: Record<string, number> = {
  runno: 0,
  'app-builder': 1,
};

const NATIVE_AGENT_CHOICES_BY_APP_ID: Record<string, 'Runno' | 'AppBuilder'> = {
  runno: 'Runno',
  'app-builder': 'AppBuilder',
};

type AppDisplayEntry = Pick<
  NativeAppCatalogEntry | ProductAppCatalogEntry,
  'id' | 'name' | 'description' | 'authors' | 'icon' | 'category' | 'tags'
> & {
  dependencySummary?: string | null;
};

function isAssetIcon(icon: AppIconSpec): boolean {
  return icon.kind === 'packageAsset' || icon.kind === 'nativeAsset';
}

function pinSystemAppsFirst<T extends Pick<ProductAppCatalogEntry, 'id' | 'appId'>>(
  apps: T[],
): T[] {
  return [...apps].sort((left, right) => {
    const leftOrder = PINNED_SYSTEM_APP_ORDER[left.appId ?? left.id] ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = PINNED_SYSTEM_APP_ORDER[right.appId ?? right.id] ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });
}

function pinKeyForApp(app: NativeAppCatalogEntry | ProductAppCatalogEntry): string {
  return 'appId' in app ? app.appId : app.id;
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
  }
  return pinSystemAppsFirst(sorted);
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

function filterManagedApp(app: ProductAppCatalogEntry, section: ManageSection): boolean {
  switch (section) {
    case 'updates':
      return app.installed === true && app.updateAvailable === true;
    case 'disabled':
      return app.installed === true && app.enabled !== true;
    case 'creations':
      return app.ownerKind !== 'system'
        || (app.releases ?? []).some((release) => release.provenance === 'aiGenerated');
    case 'apps':
      return app.installed === true;
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

function visibleAuthors(authors?: AppAuthor[] | null): AppAuthor[] {
  return (authors ?? []).filter((author) => author.name.trim().length > 0);
}

function AppAuthorLine({
  authors,
  t,
}: {
  authors?: AppAuthor[] | null;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const visible = visibleAuthors(authors);
  if (!visible.length) return null;

  const label = visible.length > 1
    ? t('productSystem.fields.authors')
    : t('productSystem.fields.author');

  return (
    <span className="apps-scene__app-card-authors">
      <span className="apps-scene__app-card-authors-label">{label}</span>
      <span className="apps-scene__app-card-authors-separator" aria-hidden>·</span>
      <span className="apps-scene__app-card-authors-list">
        {visible.map((author, index) => (
          <React.Fragment key={`${author.name}-${author.url ?? index}`}>
            {index > 0 ? ', ' : null}
            {author.url ? (
              <a
                href={author.url}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                {author.name}
              </a>
            ) : (
              <span>{author.name}</span>
            )}
          </React.Fragment>
        ))}
      </span>
    </span>
  );
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

function modeForPage(page: ReturnType<typeof useAppsStore.getState>['page']): AppCenterMode {
  if (page === 'manage') return 'manage';
  return 'home';
}

function inertWhen<T extends HTMLElement>(inactive: boolean): React.HTMLAttributes<T> {
  return inactive ? ({ inert: '' } as unknown as React.HTMLAttributes<T>) : {};
}

function statusVariant(status: WorkRecord['status']): 'neutral' | 'success' | 'warning' | 'error' | 'info' {
  if (status === 'running') return 'success';
  if (status === 'waiting_user' || status === 'blocked') return 'warning';
  if (status === 'failed' || status === 'cancelled' || status === 'interrupted') return 'error';
  if (status === 'completed') return 'info';
  return 'neutral';
}

export const AppsScene: React.FC = () => {
  const { t, i18n } = useTranslation('scenes/apps');
  const {
    lastUsedWorkspace,
    rememberWorkspace,
  } = useWorkspaceContext();
  const workAppScope = useMemo(
    () => appScopeFromWorkspace(lastUsedWorkspace) ?? systemAppScope(),
    [lastUsedWorkspace],
  );

  const {
    page,
    appCenterView,
    manageSection,
    componentFilter,
    installedSearch,
    discoverSearch,
    manageSearch,
    componentSearch,
    manageSort,
    selectedAppId,
    selectedAppKind,
    selectedComponentId,
    pinnedAppIds,
    setAppCenterView,
    setManageSection,
    setComponentFilter,
    setInstalledSearch,
    setDiscoverSearch,
    setManageSearch,
    setComponentSearch,
    setManageSort,
    togglePinnedApp,
    openHome,
    openManage,
    openAppDetail,
    closeAppDetail,
    openComponentCenter,
  } = useAppsStore();

  const works = useWorkStore((state) => state.works);
  const worksLoaded = useWorkStore((state) => state.loaded);
  const refreshWorks = useWorkStore((state) => state.refreshWorks);
  const runningProductAppRuntimeIds = useProductAppRuntimeStore((state) => state.runningWorkerIds);
  const markProductAppRuntimeWorkerStopped = useProductAppRuntimeStore((state) => state.markWorkerStopped);

  const [homeApps, setHomeApps] = useState<ProductAppCatalogEntry[]>([]);
  const [visibleHomeApps, setVisibleHomeApps] = useState<ProductAppCatalogEntry[]>([]);
  const [homeRevealPendingCount, setHomeRevealPendingCount] = useState(0);
  const [visibleDiscoverApps, setVisibleDiscoverApps] = useState<ProductAppCatalogEntry[]>([]);
  const [discoverRevealPendingCount, setDiscoverRevealPendingCount] = useState(0);
  const [libraryApps, setLibraryApps] = useState<ProductAppCatalogEntry[]>([]);
  const [nativeApps, setNativeApps] = useState<NativeAppCatalogEntry[]>([]);
  const [components, setComponents] = useState<ComponentDefinition[]>([]);
  const [intelligentCatalog, setIntelligentCatalog] = useState<IntelligentAppCatalog | null>(null);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [componentsLoaded, setComponentsLoaded] = useState(false);
  const [nativeLoading, setNativeLoading] = useState(false);
  const [productHomeLoading, setProductHomeLoading] = useState(true);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [componentsLoading, setComponentsLoading] = useState(false);
  const [intelligentCatalogLoading, setIntelligentCatalogLoading] = useState(false);
  const [launchingAppId, setLaunchingAppId] = useState<string | null>(null);
  const [stoppingAppId, setStoppingAppId] = useState<string | null>(null);
  const [managingAppId, setManagingAppId] = useState<string | null>(null);
  const [flippedAppId, setFlippedAppId] = useState<string | null>(null);
  const [manageViewMode, setManageViewMode] = useState<ManageViewMode>('cards');
  const [workspaceLaunchApp, setWorkspaceLaunchApp] = useState<ProductAppCatalogEntry | null>(null);
  const [pendingCapabilityApproval, setPendingCapabilityApproval] = useState<{
    app: ProductAppCatalogEntry;
    review: AppReleaseCapabilityReview;
  } | null>(null);
  const [nativeLoadError, setNativeLoadError] = useState<string | null>(null);
  const [productHomeLoadError, setProductHomeLoadError] = useState<string | null>(null);
  const [libraryLoadError, setLibraryLoadError] = useState<string | null>(null);
  const [componentsLoadError, setComponentsLoadError] = useState<string | null>(null);
  const [intelligentCatalogLoadError, setIntelligentCatalogLoadError] = useState<string | null>(null);
  const nativeLoadIdRef = useRef(0);
  const productHomeLoadIdRef = useRef(0);
  const libraryLoadIdRef = useRef(0);
  const componentsLoadIdRef = useRef(0);
  const intelligentCatalogLoadIdRef = useRef(0);
  const pageRetryRef = useRef<string | null>(null);
  const homeRevealQueueRef = useRef<ProductAppCatalogEntry[]>([]);
  const discoverRevealQueueRef = useRef<ProductAppCatalogEntry[]>([]);
  const visibleHomeAppKeysRef = useRef<Set<string>>(new Set());
  const visibleDiscoverAppKeysRef = useRef<Set<string>>(new Set());
  const homeRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const discoverRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const pendingCardRectsRef = useRef<Map<string, DOMRect>>(new Map());
  const pendingCardMorphRef = useRef(false);

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
      setNativeApps(native);
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
      const orderedApps = pinSystemAppsFirst(catalog.apps);
      setHomeApps(orderedApps);
      beginHomeAppReveal(orderedApps);
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
      const nextLibraryApps = pinSystemAppsFirst(mergeProductAppLibrary(library));
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

  const loadIntelligentCatalog = useCallback(async () => {
    const loadId = intelligentCatalogLoadIdRef.current + 1;
    intelligentCatalogLoadIdRef.current = loadId;
    setIntelligentCatalogLoading(true);
    setIntelligentCatalogLoadError(null);
    try {
      const catalog = await intelligentAppAPI.listCatalog();
      if (intelligentCatalogLoadIdRef.current !== loadId) return;
      setIntelligentCatalog(catalog);
    } catch (error) {
      if (intelligentCatalogLoadIdRef.current !== loadId) return;
      log.error('Failed to load Intelligent App catalog', { error });
      setIntelligentCatalogLoadError(errorToMessage(error));
    } finally {
      if (intelligentCatalogLoadIdRef.current === loadId) setIntelligentCatalogLoading(false);
    }
  }, []);

  const loadCatalog = useCallback(async (options: { force?: boolean } = {}) => {
    const loads: Array<Promise<void>> = [
      loadNativeCatalog(options),
      loadProductHomeCatalog(options),
      loadProductAppLibrary(options),
    ];
    if (componentsLoaded || manageSection === 'components' || selectedAppId) {
      loads.push(loadComponents(options));
    }
    await Promise.allSettled(loads);
  }, [
    componentsLoaded,
    loadComponents,
    loadNativeCatalog,
    loadProductAppLibrary,
    loadProductHomeCatalog,
    manageSection,
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
    if (page !== 'manage' || intelligentCatalog || intelligentCatalogLoading) return;
    void loadIntelligentCatalog();
  }, [intelligentCatalog, intelligentCatalogLoading, loadIntelligentCatalog, page]);

  useEffect(() => {
    const shouldLoadComponents = manageSection === 'components' || selectedAppId !== null;
    if (!shouldLoadComponents || componentsLoaded || componentsLoading) return;
    void loadComponents();
  }, [componentsLoaded, componentsLoading, loadComponents, manageSection, selectedAppId]);

  useEffect(() => {
    if (!worksLoaded) {
      void refreshWorks();
    }
  }, [refreshWorks, worksLoaded]);

  const currentLocale = i18n.language;
  const displayNativeApps = useMemo(
    () => localizeCatalogApps(nativeApps, currentLocale),
    [currentLocale, nativeApps],
  );
  const localizedHomeApps = useMemo(
    () => localizeCatalogApps(homeApps, currentLocale),
    [currentLocale, homeApps],
  );
  const localizedVisibleHomeApps = useMemo(
    () => localizeCatalogApps(visibleHomeApps, currentLocale),
    [currentLocale, visibleHomeApps],
  );
  const localizedVisibleDiscoverApps = useMemo(
    () => localizeCatalogApps(visibleDiscoverApps, currentLocale),
    [currentLocale, visibleDiscoverApps],
  );
  const localizedLibraryApps = useMemo(
    () => localizeCatalogApps(libraryApps, currentLocale),
    [currentLocale, libraryApps],
  );
  const homeDisplayApps = localizedVisibleHomeApps;
  const managementApps = libraryLoaded ? localizedLibraryApps : localizedHomeApps;
  const detailApps = libraryLoaded ? localizedLibraryApps : localizedHomeApps;
  const homeSyncActive = productHomeLoading || homeRevealPendingCount > 0;
  const discoverSyncActive = libraryLoading || discoverRevealPendingCount > 0;
  const loading = nativeLoading || productHomeLoading || libraryLoading || componentsLoading || intelligentCatalogLoading;
  const homeInitialLoading = nativeLoading && nativeApps.length === 0 && visibleHomeApps.length === 0;
  const loadError = [
    nativeLoadError,
    productHomeLoadError,
    page === 'manage' ? libraryLoadError : null,
    page === 'manage' && manageSection === 'components' ? componentsLoadError : null,
    page === 'manage' ? intelligentCatalogLoadError : null,
  ].filter(Boolean).join('\n') || null;

  const installedQuery = normalized(installedSearch);
  const discoverQuery = normalized(discoverSearch);
  const manageQuery = normalized(manageSearch);
  const componentQuery = normalized(componentSearch);
  const appsById = useMemo(() => new Map(detailApps.map((app) => [app.id, app])), [detailApps]);
  const runningSurfaceAppIdSet = useMemo(
    () => new Set(runningProductAppRuntimeIds),
    [runningProductAppRuntimeIds],
  );

  const launchNativeApps = useMemo(() => displayNativeApps
    .filter((app) => appMatchesSearch(app, installedQuery)), [displayNativeApps, installedQuery]);

  const launchApps = useMemo(() => homeDisplayApps
    .filter((app) => app.installed === true)
    .filter((app) => app.enabled)
    .filter((app) => !appHasCatalogIssues(app))
    .filter((app) => app.catalogVisibility !== 'hidden')
    .filter((app) => appMatchesSearch(app, installedQuery)), [homeDisplayApps, installedQuery]);

  const launchCardCount = launchNativeApps.length + launchApps.length;

  const discoverApps = useMemo(() => localizedVisibleDiscoverApps
    .filter((app) => appMatchesSearch(app, discoverQuery)), [discoverQuery, localizedVisibleDiscoverApps]);

  const manageApps = useMemo(() => {
    const filtered = managementApps
      .filter((app) => filterManagedApp(app, manageSection))
      .filter((app) => appMatchesSearch(app, manageQuery));
    return sortManageApps(filtered, manageSort, runningSurfaceAppIdSet);
  }, [managementApps, manageQuery, manageSection, manageSort, runningSurfaceAppIdSet]);

  const continueWorks = useMemo(() => works
    .filter((work) => OPEN_WORK_STATUSES.has(work.status))
    .map((work) => ({ work, appRef: appRefFromWork(work) }))
    .filter((item): item is { work: WorkRecord; appRef: WorkAppRef } => Boolean(item.appRef))
    .filter((item) => {
      const nativeApp = displayNativeApps.find((candidate) => sameAppRef(nativeAppWorkRef(candidate.id), item.appRef));
      if (nativeApp) {
        return nativeAppSupportsMultipleWorks(nativeApp)
          && workMatchesSearch(item.work, nativeApp.name, installedQuery);
      }
      const app = homeDisplayApps.find((candidate) => sameProductAppRef(productAppWorkRef(candidate), item.appRef));
      return Boolean(app)
        && app?.installed === true
        && !appHasCatalogIssues(app)
        && getCatalogAppLaunchBehavior(app).supportsMultipleWorks
        && workMatchesSearch(item.work, app?.name, installedQuery);
    })
    .sort((left, right) => right.work.updatedAt - left.work.updatedAt), [displayNativeApps, homeDisplayApps, installedQuery, works]);

  const filteredComponents = useMemo(() => components
    .filter((component) => componentFilter === 'all' || component.kind === componentFilter)
    .filter((component) => componentMatchesSearch(component, componentQuery)), [componentFilter, components, componentQuery]);

  const selectedApp = selectedAppId ? appsById.get(selectedAppId) ?? null : null;
  const selectedNativeApp = selectedAppKind === 'native' && selectedAppId
    ? displayNativeApps.find((app) => app.id === selectedAppId) ?? null
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
      const app = displayNativeApps.find((candidate) => sameAppRef(nativeAppWorkRef(candidate.id), item.appRef));
      if (!app) continue;
      const current = byApp.get(app.id) ?? [];
      current.push(item);
      byApp.set(app.id, current);
    }
    return byApp;
  }, [continueWorks, displayNativeApps]);

  const runningAppsWithoutWork = useMemo(() => launchApps.filter((app) => (
    runningSurfaceAppIdSet.has(app.id)
    && !(continueWorksByAppId.get(app.id)?.length)
  )), [continueWorksByAppId, launchApps, runningSurfaceAppIdSet]);
  const activeItemCount = continueWorks.length + runningAppsWithoutWork.length;
  const visibleContinueWorks = continueWorks.slice(0, HOME_ACTIVITY_LIMIT);
  const pinnedApps = useMemo(() => {
    const available = [...displayNativeApps, ...launchApps];
    const explicit = pinnedAppIds
      .map((id) => available.find((app) => pinKeyForApp(app) === id))
      .filter((app): app is NativeAppCatalogEntry | ProductAppCatalogEntry => Boolean(app));
    const filled = [...explicit];
    for (const app of available) {
      if (filled.length >= 4) break;
      if (!filled.some((candidate) => pinKeyForApp(candidate) === pinKeyForApp(app))) filled.push(app);
    }
    return filled.slice(0, 4);
  }, [displayNativeApps, launchApps, pinnedAppIds]);

  const captureActiveCardRects = useCallback(() => {
    const activePanel = shellRef.current?.querySelector<HTMLElement>('.app-center-shell__main-panel.is-active');
    const rects = new Map<string, DOMRect>();
    activePanel?.querySelectorAll<HTMLElement>('[data-app-id]').forEach((element) => {
      const appId = element.dataset.appId;
      const rect = element.getBoundingClientRect();
      if (appId && rect.width > 0 && rect.height > 0 && !rects.has(appId)) rects.set(appId, rect);
    });
    return rects;
  }, []);

  const handleCenterModeChange = useCallback((mode: AppCenterMode) => {
    if (mode === modeForPage(page)) return;
    const canMorphCards = page === 'manage' || appCenterView === 'installed';
    pendingCardMorphRef.current = canMorphCards;
    pendingCardRectsRef.current = canMorphCards ? captureActiveCardRects() : new Map();
    if (mode === 'home') openHome();
    if (mode === 'manage') openManage(manageSection);
  }, [appCenterView, captureActiveCardRects, manageSection, openHome, openManage, page]);

  useLayoutEffect(() => {
    if (!pendingCardMorphRef.current || !shellRef.current) return;
    pendingCardMorphRef.current = false;
    const previousRects = pendingCardRectsRef.current;
    pendingCardRectsRef.current = new Map();
    if (!previousRects.size || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const frame = window.requestAnimationFrame(() => {
      const activePanel = shellRef.current?.querySelector<HTMLElement>('.app-center-shell__main-panel.is-active');
      activePanel?.querySelectorAll<HTMLElement>('[data-app-id]').forEach((element) => {
        const appId = element.dataset.appId;
        if (!appId) return;
        const previousRect = previousRects.get(appId);
        if (!previousRect) return;
        const nextRect = element.getBoundingClientRect();
        if (nextRect.width <= 0 || nextRect.height <= 0) return;
        const translateX = previousRect.left - nextRect.left;
        const translateY = previousRect.top - nextRect.top;
        const scaleX = previousRect.width / nextRect.width;
        const scaleY = previousRect.height / nextRect.height;
        element.animate([
          {
            opacity: 0.58,
            transform: `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`,
            transformOrigin: 'top left',
          },
          { opacity: 1, transform: 'none', transformOrigin: 'top left' },
        ], {
          duration: 320,
          easing: 'cubic-bezier(0.2, 0, 0, 1)',
        });
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [page]);

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
        || app.launch?.kind === 'appBuilder'
      ) {
        if (catalogAppRequiresWorkspace(app)) {
          setWorkspaceLaunchApp(app);
          return;
        }
        await launchActiveIntelligentApp(app.activeRef!, {
          scope: workAppScope,
          title: app.name,
          objective: app.description || app.name,
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
  }, [workAppScope, t]);

  const handleLaunchNativeApp = useCallback(async (app: NativeAppCatalogEntry) => {
    setLaunchingAppId(app.id);
    try {
      if (app.launch?.kind === 'agentSession' || app.launch?.kind === 'appBuilder') {
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
          objective: app.description || app.name,
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

  const handleSetProductAppEnabled = useCallback(async (
    app: ProductAppCatalogEntry,
    enabled: boolean,
  ) => {
    setManagingAppId(app.id);
    try {
      if (enabled) {
        const review = await intelligentAppAPI.getReleaseCapabilityReview(
          app.appId,
          app.availableReleaseId,
        );
        if (review.requiresApproval && !review.approved) {
          setPendingCapabilityApproval({ app, review });
          return;
        }
      }
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
      const review = await intelligentAppAPI.getReleaseCapabilityReview(
        app.appId,
        app.availableReleaseId,
      );
      if (review.requiresApproval && !review.approved) {
        setPendingCapabilityApproval({ app, review });
        return;
      }
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

  const handleApproveCapabilities = useCallback(async () => {
    if (!pendingCapabilityApproval) return;
    const { app } = pendingCapabilityApproval;
    setManagingAppId(app.id);
    try {
      await intelligentAppAPI.approveCapabilities({
        appId: app.appId,
        releaseId: app.availableReleaseId,
      });
      await intelligentAppAPI.activateRelease({
        slotId: app.slotId,
        appId: app.appId,
        releaseId: app.availableReleaseId,
      });
      setPendingCapabilityApproval(null);
      await loadCatalog({ force: true });
      notificationService.success(t('productSystem.manage.installedToast', { name: app.name }));
    } catch (error) {
      notificationService.error(error instanceof Error ? error.message : String(error));
    } finally {
      setManagingAppId(null);
    }
  }, [loadCatalog, pendingCapabilityApproval, t]);

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

  const handleCustomizeApp = useCallback(async (productApp: ProductAppCatalogEntry) => {
    setManagingAppId(productApp.id);
    try {
      const catalog = await intelligentAppAPI.listCatalog();
      const variant = catalog.slots
        .flatMap((slot) => slot.variants)
        .find(({ app }) => app.appId === productApp.appId);
      if (!variant) throw new Error(`App not found: ${productApp.appId}`);

      if (variant.app.owner.kind === 'system') {
        const created = await intelligentAppAPI.forkApp({
          sourceReleaseId: productApp.activeRef?.releaseId ?? productApp.releaseId,
          displayName: productApp.name,
          description: productApp.description,
          slotId: productApp.slotId,
        });
        await openAppBuilderSession({ ...created, scope: workAppScope });
      } else {
        const existingDraft = catalog.drafts.find((draft) => draft.appId === productApp.appId);
        const draft = existingDraft ?? await intelligentAppAPI.createDraft(
          productApp.appId,
          productApp.activeRef?.releaseId ?? productApp.releaseId,
        );
        await openAppBuilderSession({ app: variant.app, draft, scope: workAppScope });
      }
      closeAppDetail();
      await Promise.allSettled([
        loadProductAppLibrary({ force: true }),
        loadProductHomeCatalog({ force: true }),
      ]);
    } catch (error) {
      log.error('Failed to customize Intelligent App', { appId: productApp.appId, error });
      notificationService.error(error instanceof Error ? error.message : String(error));
    } finally {
      setManagingAppId(null);
    }
  }, [closeAppDetail, loadProductAppLibrary, loadProductHomeCatalog, workAppScope]);

  const handleRollbackApp = useCallback(async (productApp: ProductAppCatalogEntry) => {
    setManagingAppId(productApp.id);
    try {
      await intelligentAppAPI.rollbackActivation(productApp.slotId);
      await loadCatalog({ force: true });
      notificationService.success(t('productSystem.messages.rolledBack', { name: productApp.name }));
    } catch (error) {
      notificationService.error(error instanceof Error ? error.message : String(error));
    } finally {
      setManagingAppId(null);
    }
  }, [loadCatalog, t]);

  const handleSyncUpstream = useCallback(async (productApp: ProductAppCatalogEntry) => {
    if (!productApp.upstreamLatestReleaseId) return;
    setManagingAppId(productApp.id);
    try {
      const catalog = await intelligentAppAPI.listCatalog();
      const variant = catalog.slots
        .flatMap((slot) => slot.variants)
        .find(({ app }) => app.appId === productApp.appId);
      if (!variant) throw new Error(`App not found: ${productApp.appId}`);
      const draft = await intelligentAppAPI.createRebaseDraft({
        appId: productApp.appId,
        currentReleaseId: productApp.activeRef?.releaseId ?? productApp.releaseId,
        targetUpstreamReleaseId: productApp.upstreamLatestReleaseId,
      });
      await openAppBuilderSession({ app: variant.app, draft, scope: workAppScope });
      closeAppDetail();
    } catch (error) {
      notificationService.error(error instanceof Error ? error.message : String(error));
    } finally {
      setManagingAppId(null);
    }
  }, [closeAppDetail, workAppScope]);

  const handleOpenAppBuilder = useCallback(async () => {
    await createAndOpenAppBuilder({
      scope: workAppScope,
    });
  }, [workAppScope]);

  const handleOpenDraft = useCallback(async (draft: AppDraftRecord) => {
    const catalog = intelligentCatalog ?? await intelligentAppAPI.listCatalog();
    const variant = catalog.slots
      .flatMap((slot) => slot.variants)
      .find(({ app }) => app.appId === draft.appId);
    if (!variant) {
      notificationService.error(t('productSystem.manage.drafts.missingApp'));
      return;
    }
    await openAppBuilderSession({ app: variant.app, draft, scope: workAppScope });
  }, [intelligentCatalog, t, workAppScope]);

  const workspaceLaunchDialog = (
    <NewWorkDialog
      open={Boolean(workspaceLaunchApp)}
      onClose={() => setWorkspaceLaunchApp(null)}
      initialAgentChoice={workspaceLaunchApp ? productAppWorkChoice(workspaceLaunchApp.slotId) : undefined}
    />
  );

  const capabilityApprovalDialog = (
    <Dialog
      open={Boolean(pendingCapabilityApproval)}
      onOpenChange={(open) => { if (!open) setPendingCapabilityApproval(null); }}
      title={t('productSystem.capabilities.title')}
      size="medium"
    >
      <DialogBody>
        <p>{t('productSystem.capabilities.description', {
          name: pendingCapabilityApproval?.app.name ?? '',
        })}</p>
        <ul>
          {pendingCapabilityApproval?.review.capabilities.map((capability) => (
            <li key={capability}>{capability}</li>
          ))}
        </ul>
        <p>{t('productSystem.capabilities.scopeNote')}</p>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => setPendingCapabilityApproval(null)}>
          {t('productSystem.actions.cancel')}
        </Button>
        <Button variant="primary" onClick={() => void handleApproveCapabilities()}>
          <ShieldCheck size={14} aria-hidden />
          {t('productSystem.capabilities.approveAndActivate')}
        </Button>
      </DialogFooter>
    </Dialog>
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
        onCustomize={() => selectedApp && void handleCustomizeApp(selectedApp)}
        onRollback={() => selectedApp && void handleRollbackApp(selectedApp)}
        onSyncUpstream={() => selectedApp && void handleSyncUpstream(selectedApp)}
      />
    );
  })() : null;

  return (
    <>
      <Scene
        ref={shellRef}
        className={`apps-scene product-apps-scene app-center-shell${page === 'manage' ? ' apps-scene--manage' : ''}`}
        data-testid={page === 'manage' ? 'apps-manage-scene' : 'apps-scene'}
        data-center-mode={modeForPage(page)}
      >
        <aside className="app-center-shell__rail" aria-label={t('productSystem.homeRail.label')}>
          <AppCenterModeNav
            currentMode={modeForPage(page)}
            onChange={handleCenterModeChange}
            actions={(
              <IconButton
                className="apps-scene__mode-create"
                aria-label={t('productSystem.actions.createApp')}
                tooltip={t('productSystem.actions.createApp')}
                variant="primary"
                size="small"
                shape="circle"
                onClick={() => void handleOpenAppBuilder()}
              >
                <Plus size={14} aria-hidden />
              </IconButton>
            )}
            t={t}
          />
          <div className="app-center-shell__rail-stack">
            <div
              className={`app-center-shell__rail-panel app-center-shell__rail-panel--use${page === 'home' ? ' is-active' : ''}`}
              aria-hidden={page !== 'home'}
              {...inertWhen<HTMLDivElement>(page !== 'home')}
            >
              <section className="app-center-shell__running">
            <div className="app-center-shell__rail-heading">
              <span>{t('productSystem.homeRail.running')}</span>
              <Badge variant="success">{activeItemCount}</Badge>
            </div>
            <div className="app-center-shell__running-capsule" role="list">
              {visibleContinueWorks.slice(0, 4).map(({ work, appRef }) => {
                const app = displayNativeApps.find((candidate) => sameAppRef(nativeAppWorkRef(candidate.id), appRef))
                  ?? homeDisplayApps.find((candidate) => sameProductAppRef(productAppWorkRef(candidate), appRef));
                return (
                  <IconButton
                    key={work.id}
                    variant="ghost"
                    size="medium"
                    shape="circle"
                    role="listitem"
                    aria-label={work.title}
                    tooltip={work.title}
                    onClick={() => void openWork(work)}
                  >
                    {app ? <AppIcon app={app} size={26} /> : <Activity size={18} aria-hidden />}
                  </IconButton>
                );
              })}
              {!visibleContinueWorks.length ? <span className="app-center-shell__running-empty">{t('productSystem.homeRail.idle')}</span> : null}
            </div>
              </section>

              <section className="app-center-shell__pinned">
            <div className="app-center-shell__rail-heading">
              <span>{t('productSystem.homeRail.pinned')}</span>
            </div>
            <div className="app-center-shell__pinned-list">
              {pinnedApps.map((app) => (
                <button
                  key={pinKeyForApp(app)}
                  type="button"
                  className="app-center-shell__pinned-app"
                  onClick={() => {
                    if ('slotId' in app) void handleLaunchApp(app);
                    else void handleLaunchNativeApp(app);
                  }}
                >
                  <AppIcon app={app} size={32} />
                  <span>{app.name}</span>
                  <ArrowUpRight size={14} aria-hidden />
                </button>
              ))}
            </div>
              </section>
            </div>
            <div
              className={`app-center-shell__rail-panel app-center-shell__rail-panel--manage${page === 'manage' ? ' is-active' : ''}`}
              aria-hidden={page !== 'manage'}
              {...inertWhen<HTMLDivElement>(page !== 'manage')}
            >
              <AppManagementRailContent
                allApps={managementApps}
                activeSection={manageSection}
                catalog={intelligentCatalog}
                componentCount={components.length}
                onSectionChange={setManageSection}
                t={t}
              />
            </div>
          </div>
        </aside>

        <div className="app-center-shell__main">
          <div className="app-center-shell__main-stack">
            <section
              className={`app-center-shell__main-panel app-center-shell__main-panel--use${page === 'home' ? ' is-active' : ''}`}
              aria-hidden={page !== 'home'}
              {...inertWhen<HTMLElement>(page !== 'home')}
            >
          <header className="app-center-shell__header">
            <div className="app-center-shell__title">
              <h1 id="apps-home-title">{t('productSystem.launch.title')}</h1>
              <p>{t('productSystem.launch.subtitle')}</p>
            </div>
            <div className="apps-scene__header-actions">
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
            </div>
          </header>

          <div className="app-center-shell__toolbar">
            <Tabs
              className="app-center-shell__view-switch"
              activeKey={appCenterView}
              size="small"
              type="line"
              onChange={(value) => setAppCenterView(value as AppCenterView)}
            >
              <TabPane tabKey="installed" label={t('productSystem.homeViews.installed')} />
              <TabPane tabKey="discover" label={t('productSystem.homeViews.discover')} />
            </Tabs>
            <SearchToolbar
              className="apps-scene__search-toolbar app-center-shell__search"
              density="compact"
              aria-label={t('productSystem.searchLabel')}
              search={{
                value: appCenterView === 'installed' ? installedSearch : discoverSearch,
                onChange: appCenterView === 'installed' ? setInstalledSearch : setDiscoverSearch,
                placeholder: t('productSystem.launch.searchPlaceholder'),
                size: 'medium',
                shape: 'pill',
                inputAriaLabel: t('productSystem.searchLabel'),
              }}
            />
          </div>

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
            <div className="app-center-shell__view-stack">
              <SceneBody
                className={`app-center-shell__catalog app-center-shell__view-panel app-center-shell__view-panel--installed${appCenterView === 'installed' ? ' is-active' : ''}`}
                aria-hidden={appCenterView !== 'installed'}
                {...inertWhen<HTMLDivElement>(appCenterView !== 'installed')}
              >
                {launchCardCount || homeSyncActive ? (
                  <div className="apps-scene__app-grid">
                    {launchNativeApps.map((app) => (
                      <div className="apps-scene__app-tile" key={app.id}>
                        <PinAction app={app} pinned={pinnedAppIds.includes(pinKeyForApp(app))} onToggle={togglePinnedApp} t={t} />
                        <NativeAppCard
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
                      </div>
                    ))}
                    {launchApps.map((app) => {
                      const launchBehavior = getCatalogAppLaunchBehavior(app);
                      return (
                        <div className="apps-scene__app-tile" key={productAppLibraryKey(app)}>
                          <PinAction app={app} pinned={pinnedAppIds.includes(pinKeyForApp(app))} onToggle={togglePinnedApp} t={t} />
                          <ProductAppCard
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
                        </div>
                      );
                    })}
                    {homeSyncActive ? (
                      <CatalogGhostCard
                        label={t('productSystem.myApps.loadingProductApps')}
                        detail={t('productSystem.myApps.loadingProductAppsDetail')}
                      />
                    ) : null}
                    {activeItemCount > 1 ? (
                      <button type="button" className="apps-scene__running-summary-card" onClick={openWorkCenterHome}>
                        <span className="apps-scene__running-summary-icon" aria-hidden><Blocks size={20} /></span>
                        <span className="apps-scene__running-summary-copy">
                          <strong>{t('productSystem.homeRail.multiRunningTitle')}</strong>
                          <small>{t('productSystem.homeRail.multiRunningDescription', { count: activeItemCount })}</small>
                        </span>
                        <span className="apps-scene__running-summary-status">
                          {t('productSystem.homeRail.multiRunningStatus', { count: activeItemCount })}
                        </span>
                        <ArrowUpRight size={15} aria-hidden />
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <EmptyState imageSize="small" title={t('productSystem.myApps.emptyTitle')} description={t('productSystem.myApps.emptyDescription')} />
                )}
              </SceneBody>
              <SceneBody
                className={`app-center-shell__catalog app-center-shell__view-panel app-center-shell__view-panel--discover${appCenterView === 'discover' ? ' is-active' : ''}`}
                aria-hidden={appCenterView !== 'discover'}
                {...inertWhen<HTMLDivElement>(appCenterView !== 'discover')}
              >
                {discoverApps.length || discoverSyncActive ? (
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
                    {discoverSyncActive ? <CatalogGhostCard label={t('productSystem.discover.loading')} detail={t('productSystem.discover.loadingDetail')} /> : null}
                  </div>
                ) : (
                  <EmptyState imageSize="small" title={t('productSystem.discover.emptyTitle')} description={t('productSystem.discover.emptyDescription')} />
                )}
              </SceneBody>
            </div>
          )}
            </section>
            <section
              className={`app-center-shell__main-panel app-center-shell__main-panel--manage${page === 'manage' ? ' is-active' : ''}`}
              aria-hidden={page !== 'manage'}
              {...inertWhen<HTMLElement>(page !== 'manage')}
            >
              <AppManagementMainContent
                apps={manageApps}
                activeSection={manageSection}
                query={manageSearch}
                loading={libraryLoading || intelligentCatalogLoading}
                managingAppId={managingAppId}
                runningAppIds={runningSurfaceAppIdSet}
                sortKey={manageSort}
                viewMode={manageViewMode}
                catalog={intelligentCatalog}
                componentsContent={(
                  <ComponentCenter
                    components={filteredComponents}
                    allComponents={components}
                    activeFilter={componentFilter}
                    selectedComponent={selectedComponent}
                    workspacePath={lastUsedWorkspace?.rootPath ?? null}
                    loading={componentsLoading}
                    query={componentSearch}
                    onSearch={setComponentSearch}
                    onRefresh={() => void loadComponents({ force: true })}
                    onFilter={setComponentFilter}
                    onSelect={(component) => openComponentCenter(component.id)}
                    onClearSelection={() => openComponentCenter(null)}
                    onCreateComponent={handleOpenAppBuilder}
                    t={t}
                  />
                )}
                onSearch={setManageSearch}
                onSort={setManageSort}
                onViewModeChange={setManageViewMode}
                onRefresh={() => {
                  void Promise.allSettled([
                    loadProductAppLibrary({ force: true }),
                    loadProductHomeCatalog({ force: true }),
                    loadIntelligentCatalog(),
                    manageSection === 'components' ? loadComponents({ force: true }) : Promise.resolve(),
                  ]);
                }}
                onOpenDetails={(app) => openAppDetail(app.id)}
                onInstall={(app) => void handleInstallProductApp(app)}
                onSetEnabled={(app, enabled) => void handleSetProductAppEnabled(app, enabled)}
                onUninstall={(app) => void handleUninstallProductApp(app)}
                onOpenDraft={(draft) => void handleOpenDraft(draft)}
                t={t}
              />
            </section>
          </div>
        </div>
      </Scene>
      {appDetailDialog}
      {workspaceLaunchDialog}
      {capabilityApprovalDialog}
    </>
  );
};

function PinAction({
  app,
  pinned,
  onToggle,
  t,
}: {
  app: NativeAppCatalogEntry | ProductAppCatalogEntry;
  pinned: boolean;
  onToggle: (appId: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const label = t(pinned ? 'productSystem.actions.unpin' : 'productSystem.actions.pin', { name: app.name });
  return (
    <IconButton
      className="apps-scene__pin-action"
      variant="ghost"
      size="small"
      shape="circle"
      aria-label={label}
      tooltip={label}
      onClick={() => onToggle(pinKeyForApp(app))}
    >
      {pinned ? <PinOff size={13} aria-hidden /> : <Pin size={13} aria-hidden />}
    </IconButton>
  );
}

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

function AppManagementRailContent({
  allApps,
  activeSection,
  catalog,
  componentCount,
  onSectionChange,
  t,
}: {
  allApps: ProductAppCatalogEntry[];
  activeSection: ManageSection;
  catalog: IntelligentAppCatalog | null;
  componentCount: number;
  onSectionChange: (section: ManageSection) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const drafts = catalog?.drafts ?? [];
  const counts: Record<ManageSection, number> = {
    apps: allApps.filter((app) => app.installed === true).length,
    updates: allApps.filter((app) => filterManagedApp(app, 'updates')).length,
    disabled: allApps.filter((app) => filterManagedApp(app, 'disabled')).length,
    creations: allApps.filter((app) => filterManagedApp(app, 'creations')).length,
    drafts: drafts.length,
    components: componentCount,
  };

  return (
    <>
      <div className="apps-scene__manage-brand">
        <strong>{t('productSystem.manage.railTitle')}</strong>
        <span>{t('productSystem.manage.railSubtitle')}</span>
      </div>
      <nav className="apps-scene__manage-category-nav" role="navigation">
        {MANAGE_SECTIONS.map((section) => {
          const Icon = MANAGE_CATEGORY_ICONS[section];
          return (
            <button
              key={section}
              type="button"
              className={`apps-scene__manage-category${activeSection === section ? ' is-active' : ''}`}
              aria-current={activeSection === section ? 'page' : undefined}
              onClick={() => onSectionChange(section)}
            >
              <Icon size={17} aria-hidden />
              <span className="apps-scene__manage-category-label">
                {t(`productSystem.manage.sections.${section}`)}
              </span>
              <span className="apps-scene__manage-category-count">{counts[section]}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}

function AppManagementMainContent({
  apps,
  activeSection,
  query,
  loading,
  managingAppId,
  runningAppIds,
  sortKey,
  viewMode,
  catalog,
  componentsContent,
  onSearch,
  onSort,
  onViewModeChange,
  onRefresh,
  onOpenDetails,
  onInstall,
  onSetEnabled,
  onUninstall,
  onOpenDraft,
  t,
}: {
  apps: ProductAppCatalogEntry[];
  activeSection: ManageSection;
  query: string;
  loading: boolean;
  managingAppId: string | null;
  runningAppIds: Set<string>;
  sortKey: ManageSortKey;
  viewMode: ManageViewMode;
  catalog: IntelligentAppCatalog | null;
  componentsContent: React.ReactNode;
  onSearch: (value: string) => void;
  onSort: (sort: ManageSortKey) => void;
  onViewModeChange: (mode: ManageViewMode) => void;
  onRefresh: () => void;
  onOpenDetails: (app: ProductAppCatalogEntry) => void;
  onInstall: (app: ProductAppCatalogEntry) => void;
  onSetEnabled: (app: ProductAppCatalogEntry, enabled: boolean) => void;
  onUninstall: (app: ProductAppCatalogEntry) => void;
  onOpenDraft: (draft: AppDraftRecord) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const drafts = catalog?.drafts ?? [];
  const showAppList = ['apps', 'updates', 'disabled', 'creations'].includes(activeSection);

  return (
    <>
      <header className="app-center-shell__header">
        <div className="app-center-shell__title">
          <h1>{t('productSystem.manage.title')}</h1>
          <p>{t('productSystem.manage.subtitle')}</p>
        </div>
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
        </div>
      </header>

      <SceneBody className="apps-scene__manage-content">
        <div key={activeSection} className="apps-scene__manage-section-panel">
            <div className="apps-scene__manage-section-heading">
              <div>
                <h2>{t(`productSystem.manage.sectionTitles.${activeSection}`)}</h2>
                <p>{t(`productSystem.manage.sectionDescriptions.${activeSection}`)}</p>
              </div>
            </div>

            {showAppList ? (
              <>
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
                  actions={<ManageViewToggle viewMode={viewMode} onChange={onViewModeChange} t={t} />}
                />
                <div className="apps-scene__manage-sort" role="group" aria-label={t('productSystem.manage.sortLabel')}>
                  <span className="apps-scene__manage-sort-label">{t('productSystem.manage.sortBy')}</span>
                  <SegmentedControl
                    value={sortKey}
                    onChange={(value) => onSort(value as ManageSortKey)}
                    size="small"
                    ariaLabel={t('productSystem.manage.sortLabel')}
                    options={MANAGE_SORT_KEYS.map((key) => ({ value: key, label: t(`productSystem.manage.sortOptions.${key}`) }))}
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
                  <EmptyState imageSize="small" title={t('productSystem.manage.emptyTitle')} description={t('productSystem.manage.emptyDescription')} />
                )}
              </>
            ) : null}

            {activeSection === 'drafts' ? (
              drafts.length ? (
                <div className="apps-scene__draft-list">
                  {[...drafts].sort((left, right) => right.updatedAtMs - left.updatedAtMs).map((draft) => {
                    const app = catalog?.slots.flatMap((slot) => slot.variants).find((variant) => variant.app.appId === draft.appId)?.app;
                    return (
                      <button key={draft.draftId} type="button" onClick={() => onOpenDraft(draft)}>
                        <span className="apps-scene__draft-icon"><FilePenLine size={18} aria-hidden /></span>
                        <span><strong>{app?.displayName ?? draft.appId}</strong><small>{t('productSystem.manage.drafts.updated', { time: new Date(draft.updatedAtMs).toLocaleString() })}</small></span>
                        <ArrowUpRight size={15} aria-hidden />
                      </button>
                    );
                  })}
                </div>
              ) : <EmptyState imageSize="small" title={t('productSystem.manage.drafts.emptyTitle')} description={t('productSystem.manage.drafts.emptyDescription')} />
            ) : null}

            {activeSection === 'components' ? componentsContent : null}

        </div>
      </SceneBody>
    </>
  );
}

export function WorkResumeCard({
  work,
  app,
  appName,
  onOpen,
  t,
}: {
  work: WorkRecord;
  app?: AppDisplayEntry | null;
  appName: string;
  onOpen: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const statusLabel = t(`productSystem.status.${work.status}`, { defaultValue: work.status });
  const label = `${work.title}, ${appName}, ${statusLabel}`;
  const iconApp = app ?? {
    id: work.id,
    name: appName,
    icon: { kind: 'monogram' as const, label: appName },
  };

  return (
    <button type="button" className="apps-scene__activity-card" onClick={onOpen} aria-label={label}>
      <span
        className={[
          'apps-scene__activity-card-icon',
          isAssetIcon(iconApp.icon) && 'apps-scene__activity-card-icon--logo',
        ].filter(Boolean).join(' ')}
        aria-hidden
      >
        <AppIcon app={iconApp} size={28} />
        <StatusDot
          className="apps-scene__activity-card-status"
          tone={statusVariant(work.status)}
          size="small"
          pulse={work.status === 'running'}
        />
      </span>
      <span className="apps-scene__activity-card-copy">
        <span className="apps-scene__activity-card-meta">{appName} · {statusLabel}</span>
        <strong>{work.title}</strong>
        {work.objective ? <small>{work.objective}</small> : null}
      </span>
      <ArrowUpRight className="apps-scene__activity-card-arrow" size={16} aria-hidden />
    </button>
  );
}

export function RunningAppResumeCard({
  app,
  onOpen,
  t,
}: {
  app: ProductAppCatalogEntry;
  onOpen: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const statusLabel = t('productSystem.status.running');
  return (
    <button
      type="button"
      className="apps-scene__activity-card"
      onClick={onOpen}
      aria-label={`${app.name}, ${statusLabel}`}
    >
      <span
        className={[
          'apps-scene__activity-card-icon',
          isAssetIcon(app.icon) && 'apps-scene__activity-card-icon--logo',
        ].filter(Boolean).join(' ')}
        aria-hidden
      >
        <AppIcon app={app} size={28} />
        <StatusDot className="apps-scene__activity-card-status" tone="success" size="small" pulse />
      </span>
      <span className="apps-scene__activity-card-copy">
        <span className="apps-scene__activity-card-meta">{statusLabel}</span>
        <strong>{app.name}</strong>
        {app.description ? <small>{app.description}</small> : null}
      </span>
      <ArrowUpRight className="apps-scene__activity-card-arrow" size={16} aria-hidden />
    </button>
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
                  <AppAuthorLine authors={app.authors} t={t} />
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
                {app.description}
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
          <AppAuthorLine authors={app.authors} t={t} />
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
      <p className="apps-scene__app-card-description">{app.description}</p>
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
                  <AppAuthorLine authors={app.authors} t={t} />
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
                {app.description}
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
