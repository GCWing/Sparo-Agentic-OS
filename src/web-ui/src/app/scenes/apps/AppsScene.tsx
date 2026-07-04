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
import { mergeProductAppLibrary } from './productAppLibrary';
import { AppIcon } from './AppIcon';
import './AppsScene.scss';

const log = createLogger('AppsScene');

const PRODUCT_FILTERS: ProductAppFilter[] = ['all', 'installed', 'discover', 'conversation', 'interactive'];

const MANAGE_SORT_KEYS: ManageSortKey[] = ['attention', 'name', 'status', 'scope'];

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

  const [apps, setApps] = useState<ProductAppCatalogEntry[]>([]);
  const [nativeApps, setNativeApps] = useState<NativeAppCatalogEntry[]>([]);
  const [components, setComponents] = useState<ComponentDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [launchingAppId, setLaunchingAppId] = useState<string | null>(null);
  const [stoppingAppId, setStoppingAppId] = useState<string | null>(null);
  const [managingAppId, setManagingAppId] = useState<string | null>(null);
  const [closingResumeWorkId, setClosingResumeWorkId] = useState<string | null>(null);
  const [flippedAppId, setFlippedAppId] = useState<string | null>(null);
  const [workspaceLaunchApp, setWorkspaceLaunchApp] = useState<ProductAppCatalogEntry | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const catalogLoadIdRef = useRef(0);
  const pageRetryRef = useRef<string | null>(null);

  const loadCatalog = useCallback(async (options: { force?: boolean } = {}) => {
    const loadId = catalogLoadIdRef.current + 1;
    catalogLoadIdRef.current = loadId;
    setLoading(true);
    setLoadError(null);

    const [catalogResult, componentsResult] = await Promise.allSettled([
      appCatalogAPI.listAppCatalog({ force: options.force }),
      appCatalogAPI.listComponents({ force: options.force }),
    ]);

    if (catalogLoadIdRef.current !== loadId) return;

    const errors: string[] = [];
    if (catalogResult.status === 'fulfilled') {
      setNativeApps(catalogResult.value.native);
      setApps(mergeProductAppLibrary(catalogResult.value.productApps));
    } else {
      log.error('Failed to load App Center catalog', { error: catalogResult.reason });
      errors.push(errorToMessage(catalogResult.reason));
    }

    if (componentsResult.status === 'fulfilled') {
      setComponents(componentsResult.value);
    } else {
      log.error('Failed to load Component catalog', { error: componentsResult.reason });
      errors.push(errorToMessage(componentsResult.reason));
    }

    setLoadError(errors.length ? errors.join('\n') : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (loading) return;
    const shouldRetryEmptyCatalog = !loadError && nativeApps.length === 0 && apps.length === 0 && components.length === 0;
    const retryReason = loadError ?? (shouldRetryEmptyCatalog ? 'empty-catalog' : null);
    if (!retryReason) return;
    const retryKey = `${page}:${retryReason}`;
    if (pageRetryRef.current === retryKey) return;
    pageRetryRef.current = retryKey;
    void loadCatalog({ force: true });
  }, [apps.length, components.length, loadCatalog, loadError, loading, nativeApps.length, page]);

  useEffect(() => {
    if (!worksLoaded) {
      void refreshWorks();
    }
  }, [refreshWorks, worksLoaded]);

  const launchQuery = normalized(launchSearch);
  const manageQuery = normalized(manageSearch);
  const componentQuery = normalized(componentSearch);
  const appsById = useMemo(() => new Map(apps.map((app) => [app.id, app])), [apps]);
  const runningSurfaceAppIdSet = useMemo(
    () => new Set(runningProductAppRuntimeIds),
    [runningProductAppRuntimeIds],
  );

  const launchNativeApps = useMemo(() => nativeApps
    .filter((app) => appMatchesSearch(app, launchQuery)), [launchQuery, nativeApps]);

  const launchApps = useMemo(() => apps
    .filter((app) => app.installed === true)
    .filter((app) => app.enabled)
    .filter((app) => !appHasCatalogIssues(app))
    .filter((app) => app.catalogVisibility !== 'hidden')
    .filter((app) => appMatchesSearch(app, launchQuery)), [apps, launchQuery]);

  const launchCardCount = launchNativeApps.length + launchApps.length;

  const discoverApps = useMemo(() => apps
    .filter((app) => app.installed !== true)
    .filter((app) => app.discoverable === true)
    .filter((app) => !appHasCatalogIssues(app))
    .filter((app) => appMatchesSearch(app, launchQuery)), [apps, launchQuery]);

  const manageApps = useMemo(() => {
    const filtered = apps
      .filter((app) => filterProductApp(app, productAppFilter))
      .filter((app) => appMatchesSearch(app, manageQuery));
    return sortManageApps(filtered, manageSort, runningSurfaceAppIdSet);
  }, [apps, manageQuery, productAppFilter, manageSort, runningSurfaceAppIdSet]);

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
      const app = apps.find((candidate) => sameProductAppRef(productAppWorkRef(candidate), item.appRef));
      return Boolean(app)
        && app?.installed === true
        && !appHasCatalogIssues(app)
        && getCatalogAppLaunchBehavior(app).supportsMultipleWorks
        && workMatchesSearch(item.work, app?.name, launchQuery);
    })
    .sort((left, right) => right.work.updatedAt - left.work.updatedAt), [apps, launchQuery, nativeApps, works]);

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
      const app = apps.find((candidate) => sameProductAppRef(productAppWorkRef(candidate), item.appRef));
      if (!app) continue;
      const current = byApp.get(app.id) ?? [];
      current.push(item);
      byApp.set(app.id, current);
    }
    return byApp;
  }, [apps, continueWorks]);

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
          loading={loading}
          query={componentSearch}
          currentMode={modeForPage(page)}
          onModeChange={(mode) => {
            if (mode === 'home') openHome();
            if (mode === 'manage') openManage();
            if (mode === 'component-center') openComponentCenter();
          }}
          onSearch={setComponentSearch}
          onRefresh={() => void loadCatalog({ force: true })}
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
          allApps={apps}
          activeFilter={productAppFilter}
          query={manageSearch}
          currentMode={modeForPage(page)}
          loading={loading}
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
          onRefresh={() => void loadCatalog({ force: true })}
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
                    ?? apps.find((candidate) => sameProductAppRef(productAppWorkRef(candidate), appRef));
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

      {loading ? (
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
                actions={<Badge variant="neutral">{t('productSystem.myApps.count', { count: launchCardCount })}</Badge>}
              />
              <PanelBody>
                {launchCardCount ? (
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
                          key={app.id}
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
                          t={t}
                        />
                      );
                    })}
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

            {discoverApps.length ? (
              <Panel className="apps-scene__apps-panel apps-scene__discover-panel apps-scene__home-section apps-scene__home-section--discover">
                <PanelHeader
                  title={t('productSystem.discover.title')}
                  actions={<Badge variant="neutral">{t('productSystem.discover.count', { count: discoverApps.length })}</Badge>}
                />
                <PanelBody>
                  <div className="apps-scene__app-grid">
                    {discoverApps.map((app) => (
                      <DiscoverAppCard
                        key={app.id}
                        app={app}
                        installing={managingAppId === app.id}
                        onInstall={() => void handleInstallProductApp(app)}
                        onOpenDetails={() => openAppDetail(app.id)}
                        t={t}
                      />
                    ))}
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

          {apps.length ? (
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
  onInstall,
  onOpenDetails,
  t,
}: {
  app: ProductAppCatalogEntry;
  installing: boolean;
  onInstall: () => void;
  onOpenDetails: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <ItemCard
      className="apps-scene__app-card apps-scene__app-card--discover"
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
    <WorkCardFrame depth={hasStack ? Math.min(relatedWorks.length, 2) : 0} expanded={isExpanded}>
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
