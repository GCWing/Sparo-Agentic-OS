import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppWindow,
  BriefcaseBusiness,
  ListTodo,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  Square,
} from 'lucide-react';
import { ManagementList } from './components/ManagementList';
import { StudioPlaceholder } from './components/StudioPlaceholder';
import { ComponentCenter } from './components/ComponentCenter';
import { AppCenterModeNav } from './components/AppCenterModeNav';
import type { AppCenterMode } from './components/types';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  DotMatrixLoader,
  DropdownMenu,
  EmptyState,
  IconButton,
  ItemCard,
  ItemCardActions,
  ItemCardTitle,
  ItemCardTop,
  Panel,
  PanelBody,
  PanelHeader,
  Scene,
  SceneBody,
  SceneHeader,
  SearchToolbar,
  SegmentedControl,
  StatusDot,
  type DropdownMenuEntry,
} from '@/design-system';
import {
  appCatalogAPI,
  type AppComponentRef,
  type ComponentDefinition,
  type ComponentKind,
  type ProductAppCatalogEntry,
} from '@/infrastructure/api/service-api/AppCatalogAPI';
import { surfaceComponentAPI } from '@/infrastructure/api/service-api/SurfaceComponentAPI';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import {
  NewWorkDialog,
  launchWorkForChoice,
  productAppWorkChoice,
} from '@/app/components/WorkDock/NewWorkDialog';
import {
  productAppRequiresWorkspace,
  productAppSupportsMultipleWorks,
} from '@/app/agentic-os/work/domain/productAppLaunchPolicy';
import { useWorkStore } from '@/app/agentic-os/work/data/workStore';
import { openWork, openWorkCenterHome } from '@/app/agentic-os/work/navigation/openWork';
import { productAppWorkRef, sameProductAppRef } from '@/app/agentic-os/work/domain/productAppRefs';
import type { WorkAppRef, WorkRecord } from '@/app/agentic-os/work/domain/workTypes';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import { useAppsStore, type ManageSortKey, type ProductAppFilter } from './appsStore';
import { AppDetailScene } from './app-detail/AppDetailScene';
import { useSurfaceComponentStore } from './surface-component/surfaceComponentStore';
import { appIconFor } from './iconUtils';
import './AppsScene.scss';

const log = createLogger('AppsScene');

const PRODUCT_FILTERS: ProductAppFilter[] = ['all', 'installed', 'discover', 'conversation', 'interactive'];

const MANAGE_SORT_KEYS: ManageSortKey[] = ['name', 'status', 'scope'];

function sortManageApps(
  filtered: ProductAppCatalogEntry[],
  sort: ManageSortKey,
  runningIds: Set<string>,
): ProductAppCatalogEntry[] {
  const sorted = [...filtered];
  switch (sort) {
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

function appMatchesSearch(app: ProductAppCatalogEntry, query: string): boolean {
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
      return app.installScope === 'system' || app.installScope === 'workspace' || app.installScope === 'project';
    case 'discover':
      return app.catalogVisibility === 'discoverable';
    case 'conversation':
      return app.interactionModel === 'conversation';
    case 'interactive':
      return app.interactionModel === 'interactiveWorkspace';
    case 'all':
    default:
      return true;
  }
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

function countComponentsByKind(components: ComponentDefinition[]): Record<ComponentKind, number> {
  return components.reduce((acc, component) => {
    acc[component.kind] = (acc[component.kind] ?? 0) + 1;
    return acc;
  }, {} as Record<ComponentKind, number>);
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
    detailReturnPage,
    productAppFilter,
    componentFilter,
    launchSearch,
    manageSearch,
    componentSearch,
    manageSort,
    selectedAppId,
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
    openComponentCenter,
    openCreateApp,
    openCreateComponent,
  } = useAppsStore();

  const works = useWorkStore((state) => state.works);
  const worksLoaded = useWorkStore((state) => state.loaded);
  const refreshWorks = useWorkStore((state) => state.refreshWorks);
  const runningSurfaceAppIds = useSurfaceComponentStore((state) => state.runningWorkerIds);
  const markSurfaceWorkerStopped = useSurfaceComponentStore((state) => state.markWorkerStopped);

  const [apps, setApps] = useState<ProductAppCatalogEntry[]>([]);
  const [components, setComponents] = useState<ComponentDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [launchingAppId, setLaunchingAppId] = useState<string | null>(null);
  const [stoppingAppId, setStoppingAppId] = useState<string | null>(null);
  const [workspaceLaunchApp, setWorkspaceLaunchApp] = useState<ProductAppCatalogEntry | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [nextApps, nextComponents] = await Promise.all([
        appCatalogAPI.listAppCatalog(),
        appCatalogAPI.listComponents(),
      ]);
      setApps(nextApps);
      setComponents(nextComponents);
    } catch (error) {
      log.error('Failed to load Product App catalog', { error });
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (!worksLoaded) {
      void refreshWorks();
    }
  }, [refreshWorks, worksLoaded]);

  const launchQuery = normalized(launchSearch);
  const manageQuery = normalized(manageSearch);
  const componentQuery = normalized(componentSearch);
  const appsById = useMemo(() => new Map(apps.map((app) => [app.id, app])), [apps]);
  const componentCounts = useMemo(() => countComponentsByKind(components), [components]);
  const runningSurfaceAppIdSet = useMemo(
    () => new Set(runningSurfaceAppIds),
    [runningSurfaceAppIds],
  );

  const launchApps = useMemo(() => apps
    .filter((app) => app.enabled)
    .filter((app) => app.catalogVisibility !== 'hidden')
    .filter((app) => appMatchesSearch(app, launchQuery))
    .slice(0, 24), [apps, launchQuery]);

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
      const app = apps.find((candidate) => sameProductAppRef(productAppWorkRef(candidate), item.appRef));
      return Boolean(app)
        && productAppSupportsMultipleWorks(app)
        && workMatchesSearch(item.work, app?.name, launchQuery);
    })
    .sort((left, right) => right.work.updatedAt - left.work.updatedAt), [apps, launchQuery, works]);

  const resumeWorks = continueWorks.slice(0, 2);

  const filteredComponents = useMemo(() => components
    .filter((component) => componentFilter === 'all' || component.kind === componentFilter)
    .filter((component) => componentMatchesSearch(component, componentQuery)), [componentFilter, components, componentQuery]);

  const selectedApp = selectedAppId ? appsById.get(selectedAppId) ?? null : null;
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

  const handleLaunchApp = useCallback(async (app: ProductAppCatalogEntry) => {
    setLaunchingAppId(app.id);
    try {
      if (app.launch?.kind === 'applicationSurface' || app.launch?.kind === 'agentSession') {
        if (productAppRequiresWorkspace(app)) {
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
      if (app.launch?.kind === 'appStudio') {
        openCreateApp();
        return;
      }
      if (app.launch?.kind === 'componentStudio') {
        openCreateComponent();
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
  }, [lastUsedWorkspace, openCreateApp, openCreateComponent, rememberWorkspace, t]);

  const handleStopApp = useCallback(async (app: ProductAppCatalogEntry) => {
    setStoppingAppId(app.id);
    try {
      await surfaceComponentAPI.workerStop(app.id);
      markSurfaceWorkerStopped(app.id);
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
  }, [markSurfaceWorkerStopped, t]);

  const workspaceLaunchDialog = (
    <NewWorkDialog
      open={Boolean(workspaceLaunchApp)}
      onClose={() => setWorkspaceLaunchApp(null)}
      initialAgentChoice={workspaceLaunchApp ? productAppWorkChoice(workspaceLaunchApp.id) : undefined}
      initialScopeRequirement={workspaceLaunchApp?.launch?.scopeRequirement}
    />
  );

  if (page === 'app-detail' && selectedApp) {
    const handleDetailBack = () => {
      if (detailReturnPage === 'manage') openManage();
      else openHome();
    };

    return (
      <>
        <AppDetailScene
          app={selectedApp}
          components={selectedAppComponents}
          works={works}
          onBack={handleDetailBack}
          onLaunch={() => void handleLaunchApp(selectedApp)}
          onStop={() => void handleStopApp(selectedApp)}
          running={runningSurfaceAppIdSet.has(selectedApp.id)}
          stopping={stoppingAppId === selectedApp.id}
          onOpenWork={(work) => void openWork(work)}
          onOpenComponent={(componentId) => openComponentCenter(componentId)}
        />
        {workspaceLaunchDialog}
      </>
    );
  }

  if (page === 'component-center') {
    return (
      <ComponentCenter
        components={filteredComponents}
        allComponents={components}
        componentCounts={componentCounts}
        activeFilter={componentFilter}
        selectedComponent={selectedComponent}
        loading={loading}
        query={componentSearch}
        currentMode={modeForPage(page)}
        onModeChange={(mode) => {
          if (mode === 'home') openHome();
          if (mode === 'manage') openManage();
          if (mode === 'component-center') openComponentCenter();
        }}
        onSearch={setComponentSearch}
        onBack={openHome}
        onRefresh={() => void loadCatalog()}
        onFilter={setComponentFilter}
        onSelect={(component) => openComponentCenter(component.id)}
        onCreateComponent={openCreateComponent}
        t={t}
      />
    );
  }

  if (page === 'manage') {
    return (
      <>
        <AppManagementCenter
          apps={manageApps}
          totalApps={apps.length}
          activeFilter={productAppFilter}
          query={manageSearch}
          currentMode={modeForPage(page)}
          loading={loading}
          launchingAppId={launchingAppId}
          stoppingAppId={stoppingAppId}
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
          onRefresh={() => void loadCatalog()}
          onOpenDetails={(app) => openAppDetail(app.id)}
          onLaunch={(app) => void handleLaunchApp(app)}
          onStop={(app) => void handleStopApp(app)}
          onCreateApp={openCreateApp}
          t={t}
        />
        {workspaceLaunchDialog}
      </>
    );
  }

  if (page === 'create-app' || page === 'create-component') {
    const handleStudioBack = () => {
      if (detailReturnPage === 'manage') openManage();
      else openHome();
    };

    return (
      <StudioPlaceholder
        kind={page}
        onBack={handleStudioBack}
        onAppCreated={async (appId) => {
          await loadCatalog();
          openAppDetail(appId);
        }}
        onComponentCreated={async (componentId) => {
          await loadCatalog();
          openComponentCenter(componentId);
        }}
        t={t}
      />
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
              onClick={() => void loadCatalog()}
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
              <Button variant="primary" size="small" onClick={openCreateApp}>
                <Plus size={14} aria-hidden />
                <span>{t('productSystem.actions.createApp')}</span>
              </Button>
            </div>
          )}
        >
          <div
            className={`apps-scene__inline-resume${resumeWorks.length ? '' : ' is-empty'}`}
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
            {resumeWorks.length ? (
              <div className="apps-scene__inline-resume-items">
                {resumeWorks.map(({ work, appRef }) => {
                  const app = apps.find((candidate) => sameProductAppRef(productAppWorkRef(candidate), appRef));
                  return (
                    <WorkResumeCard
                      key={work.id}
                      work={work}
                      app={app}
                      appName={app?.name ?? appRef.appId}
                      onOpen={() => void openWork(work)}
                      t={t}
                    />
                  );
                })}
              </div>
            ) : (
              <span className="apps-scene__inline-resume-empty">{t('productSystem.continue.emptyTitle')}</span>
            )}
            {resumeWorks.length ? (
              <Button className="apps-scene__inline-resume-all" variant="ghost" size="small" onClick={openWorkCenterHome}>
                {t('productSystem.continue.viewAll')}
              </Button>
            ) : null}
          </div>
        </SearchToolbar>

      {loadError ? (
        <div className="apps-scene__error">
          <span>{loadError}</span>
          <Button size="small" variant="secondary" onClick={() => void loadCatalog()}>
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
            <Panel className="apps-scene__apps-panel">
              <PanelHeader
                title={t('productSystem.myApps.title')}
                description={t('productSystem.launch.appsDescription')}
                actions={<Badge variant="neutral">{t('productSystem.myApps.count', { count: launchApps.length })}</Badge>}
              />
              <PanelBody>
                {launchApps.length ? (
                  <div className="apps-scene__app-grid">
                    {launchApps.map((app) => (
                      <ProductAppCard
                        key={app.id}
                        app={app}
                        launching={launchingAppId === app.id}
                        stopping={stoppingAppId === app.id}
                        running={runningSurfaceAppIdSet.has(app.id)}
                        supportsMultipleWorks={productAppSupportsMultipleWorks(app)}
                        relatedWorks={productAppSupportsMultipleWorks(app)
                          ? continueWorksByAppId.get(app.id)?.map(({ work }) => work) ?? []
                          : []}
                        onLaunch={() => void handleLaunchApp(app)}
                        onStop={() => void handleStopApp(app)}
                        onContinue={(work) => void openWork(work)}
                        onOpenDetails={() => openAppDetail(app.id)}
                        t={t}
                      />
                    ))}
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
          </div>
        </SceneBody>
      )}
      </Scene>
      {workspaceLaunchDialog}
    </>
  );
};

function AppManagementCenter({
  apps,
  totalApps,
  activeFilter,
  query,
  currentMode,
  loading,
  launchingAppId,
  stoppingAppId,
  runningAppIds,
  sortKey,
  onModeChange,
  onSearch,
  onFilter,
  onSort,
  onRefresh,
  onOpenDetails,
  onLaunch,
  onStop,
  onCreateApp,
  t,
}: {
  apps: ProductAppCatalogEntry[];
  totalApps: number;
  activeFilter: ProductAppFilter;
  query: string;
  currentMode: AppCenterMode;
  loading: boolean;
  launchingAppId: string | null;
  stoppingAppId: string | null;
  runningAppIds: Set<string>;
  sortKey: ManageSortKey;
  onModeChange: (mode: AppCenterMode) => void;
  onSearch: (value: string) => void;
  onFilter: (filter: ProductAppFilter) => void;
  onSort: (sort: ManageSortKey) => void;
  onRefresh: () => void;
  onOpenDetails: (app: ProductAppCatalogEntry) => void;
  onLaunch: (app: ProductAppCatalogEntry) => void;
  onStop: (app: ProductAppCatalogEntry) => void;
  onCreateApp: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <Scene className="apps-scene apps-scene--manage">
      <AppCenterModeNav currentMode={currentMode} onChange={onModeChange} t={t} />

      <SceneHeader
        eyebrow={t('productSystem.manage.eyebrow')}
        title={t('productSystem.manage.title')}
        description={t('productSystem.manage.subtitle')}
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
        filters={(
          <SegmentedControl
            value={activeFilter}
            onChange={(value) => onFilter(value as ProductAppFilter)}
            size="small"
            ariaLabel={t('productSystem.filters.label')}
            options={PRODUCT_FILTERS.map((filter) => ({
              value: filter,
              label: t(`productSystem.filters.${filter}`),
            }))}
          />
        )}
        actions={(
          <div className="apps-scene__toolbar-meta">
            <Badge variant="info">{t('productSystem.manage.visibleCount', { count: apps.length })}</Badge>
            <Badge variant="neutral">{t('productSystem.meta.apps', { count: totalApps })}</Badge>
          </div>
        )}
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

      <SceneBody className="apps-scene__manage-layout">
        {apps.length ? (
          <ManagementList
            apps={apps}
            launchingAppId={launchingAppId}
            stoppingAppId={stoppingAppId}
            runningAppIds={runningAppIds}
            onLaunch={onLaunch}
            onStop={onStop}
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
      </SceneBody>
    </Scene>
  );
}

function AppIcon({ app }: { app: ProductAppCatalogEntry }) {
  const Icon = appIconFor(app);
  return (
    <span className="apps-scene__app-icon" aria-hidden>
      <Icon size={18} strokeWidth={1.8} />
    </span>
  );
}

function WorkResumeCard({
  work,
  app,
  appName,
  onOpen,
  t,
}: {
  work: WorkRecord;
  app?: ProductAppCatalogEntry | null;
  appName: string;
  onOpen: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const statusLabel = t(`productSystem.status.${work.status}`, { defaultValue: work.status });
  const Icon = app ? appIconFor(app) : AppWindow;

  return (
    <button
      type="button"
      className="apps-scene__resume-chip"
      onClick={onOpen}
      aria-label={`${work.title}, ${appName}, ${statusLabel}`}
    >
      <span className="apps-scene__resume-chip-icon" aria-hidden>
        <Icon size={14} strokeWidth={1.8} />
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
  );
}

function ProductAppCard({
  app,
  launching,
  stopping,
  running,
  supportsMultipleWorks,
  relatedWorks,
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
  onLaunch: () => void;
  onStop: () => void;
  onContinue: (work: WorkRecord) => void;
  onOpenDetails: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const workMenuAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [workMenuOpen, setWorkMenuOpen] = useState(false);
  const latestWork = supportsMultipleWorks ? relatedWorks[0] ?? null : null;
  const canChooseRelatedWork = supportsMultipleWorks && Boolean(latestWork);

  useEffect(() => {
    if (!canChooseRelatedWork && workMenuOpen) {
      setWorkMenuOpen(false);
    }
  }, [canChooseRelatedWork, workMenuOpen]);

  const handleContinueWork = useCallback((work: WorkRecord) => {
    setWorkMenuOpen(false);
    onContinue(work);
  }, [onContinue]);

  const handleWorkMenuKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape' && workMenuOpen) {
      event.preventDefault();
      setWorkMenuOpen(false);
    }
  }, [workMenuOpen]);

  const relatedWorkMenuItems = useMemo((): DropdownMenuEntry[] => [
    {
      type: 'label',
      id: 'related-work-label',
      content: t('productSystem.continue.relatedLabel'),
    },
    ...relatedWorks.map((work): DropdownMenuEntry => ({
      type: 'item',
      id: work.id,
      label: (
        <span className="apps-scene__continue-menu-item">
          <StatusDot
            tone={statusVariant(work.status)}
            size="small"
            pulse={work.status === 'running'}
            label={t(`productSystem.status.${work.status}`, { defaultValue: work.status })}
          />
          <span className="apps-scene__continue-menu-title">{work.title}</span>
        </span>
      ),
      onClick: () => handleContinueWork(work),
    })),
  ], [handleContinueWork, relatedWorks, t]);

  const handlePrimaryAction = () => {
    if (latestWork) {
      handleContinueWork(latestWork);
      return;
    }
    onLaunch();
  };

  return (
    <ItemCard
      className={`apps-scene__app-card${workMenuOpen ? ' is-actions-open' : ''}`}
      onActivate={handlePrimaryAction}
      aria-label={app.name}
    >
      <ItemCardTop className="apps-scene__app-card-top">
        <AppIcon app={app} />
        <ItemCardTitle className="apps-scene__app-card-title">
          <span>{app.name}</span>
        </ItemCardTitle>
      </ItemCardTop>
      <p className="apps-scene__app-card-description">{app.goal || app.description}</p>
      <ItemCardActions
        className="apps-scene__app-card-actions"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <IconButton
          variant="ghost"
          size="small"
          shape="circle"
          className="apps-scene__card-icon-action"
          aria-label={t('productSystem.actions.details')}
          tooltip={t('productSystem.actions.details')}
          onClick={onOpenDetails}
        >
          <Settings2 size={14} aria-hidden />
        </IconButton>
        {supportsMultipleWorks ? (
          <>
            {latestWork ? (
              <div className="apps-scene__work-action">
                <IconButton
                  variant="ghost"
                  size="small"
                  shape="circle"
                  className="apps-scene__card-icon-action apps-scene__work-action-segment apps-scene__work-action-segment--new"
                  aria-label={t('productSystem.actions.newWork')}
                  tooltip={t('productSystem.actions.newWork')}
                  onClick={onLaunch}
                  disabled={launching}
                  aria-busy={launching || undefined}
                >
                  <Plus size={14} aria-hidden />
                </IconButton>
                {canChooseRelatedWork ? (
                  <>
                    <IconButton
                      ref={workMenuAnchorRef}
                      variant="ghost"
                      size="small"
                      shape="circle"
                      className={`apps-scene__card-icon-action apps-scene__work-action-segment apps-scene__work-action-segment--continue${workMenuOpen ? ' is-open' : ''}`}
                      aria-label={t('productSystem.continue.expandRelated')}
                      tooltip={t('productSystem.actions.continue')}
                      aria-haspopup="menu"
                      aria-expanded={workMenuOpen}
                      onClick={() => setWorkMenuOpen((open) => !open)}
                      onKeyDown={handleWorkMenuKeyDown}
                    >
                      <ListTodo size={14} aria-hidden />
                    </IconButton>
                    <DropdownMenu
                      open={workMenuOpen}
                      anchorRef={workMenuAnchorRef}
                      items={relatedWorkMenuItems}
                      onClose={() => setWorkMenuOpen(false)}
                      align="right"
                      minWidth={260}
                    />
                  </>
                ) : null}
              </div>
            ) : (
              <IconButton
                variant="ghost"
                size="small"
                shape="circle"
                className="apps-scene__card-icon-action"
                aria-label={t('productSystem.actions.newWork')}
                tooltip={t('productSystem.actions.newWork')}
                onClick={onLaunch}
                disabled={launching}
                aria-busy={launching || undefined}
              >
                <Plus size={14} aria-hidden />
              </IconButton>
            )}
          </>
        ) : (
          <IconButton
            variant="ghost"
            size="small"
            shape="circle"
            className="apps-scene__card-icon-action"
            aria-label={running ? t('productSystem.actions.stop') : t('productSystem.actions.launch')}
            tooltip={running ? t('productSystem.actions.stop') : t('productSystem.actions.launch')}
            onClick={running ? onStop : onLaunch}
            disabled={running ? stopping : launching}
            aria-busy={(running ? stopping : launching) || undefined}
          >
            {running ? <Square size={14} aria-hidden /> : <Play size={14} aria-hidden />}
          </IconButton>
        )}
      </ItemCardActions>
    </ItemCard>
  );
}

export default AppsScene;
