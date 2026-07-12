import React, { useCallback, useEffect, useMemo } from 'react';
import { LayoutGrid, Plus, Workflow } from 'lucide-react';
import { Button, IconButton } from '@/design-system';
import { useWorkStore } from '@/app/agentic-os/work/data/workStore';
import type { WorkAppRef, WorkRecord, WorkStatus } from '@/app/agentic-os/work/domain/workTypes';
import { catalogAppRequiresWorkspace } from '@/app/agentic-os/work/domain/productAppLaunchPolicy';
import { openWork } from '@/app/agentic-os/work/navigation/openWork';
import { AppIcon } from '@/app/scenes/apps/AppIcon';
import { useAppsStore } from '@/app/scenes/apps/appsStore';
import { createAndOpenAppBuilder } from '@/app/scenes/apps/app-builder/openAppBuilderSession';
import { launchActiveIntelligentApp } from '@/app/scenes/apps/intelligentAppLaunchService';
import { useProductAppRuntimeStore } from '@/app/scenes/apps/product-app-runtime/productAppRuntimeStore';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import {
  appCatalogAPI,
  localizeCatalogApps,
  type ProductAppCatalogEntry,
  type ProductAppLibrary,
} from '@/infrastructure/api/service-api/AppCatalogAPI';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import { appScopeFromWorkspace, systemAppScope } from '@/shared/types/app-scope';
import { createLogger } from '@/shared/utils/logger';
import {
  WorkspaceHubPreviewEmpty,
  WorkspaceHubPreviewError,
  WorkspaceHubPreviewFrame,
  WorkspaceHubPreviewLoading,
  WorkspaceHubPreviewSection,
} from './WorkspaceHubPreviewFrame';
import type { WorkspaceHubPreviewProps } from './workspaceHubPreviewTypes';
import { useHubPreviewResource } from './useHubPreviewResource';
import './AppsPreview.scss';

const log = createLogger('WorkspaceHubAppsPreview');

const CONTINUABLE_STATUSES = new Set<WorkStatus>([
  'active',
  'running',
  'waiting_user',
  'blocked',
  'paused',
  'interrupted',
]);

type AppActivityItem =
  | { kind: 'work'; work: WorkRecord; appRef: WorkAppRef }
  | { kind: 'app'; app: ProductAppCatalogEntry };

function appRefFromWork(work: WorkRecord): WorkAppRef | null {
  if (work.subject.kind === 'app') return work.subject.app;
  return work.appRefs.find(({ role }) => role === 'subject')?.app
    ?? work.appRefs.find(({ role }) => role === 'executor')?.app
    ?? work.appRefs[0]?.app
    ?? null;
}

const AppsPreview: React.FC<WorkspaceHubPreviewProps> = ({
  label,
  primaryActionRef,
  onOpenItem,
  onClose,
}) => {
  const { t, currentLanguage } = useI18n('common');
  const { lastUsedWorkspace } = useWorkspaceContext();
  const works = useWorkStore((state) => state.works);
  const worksLoaded = useWorkStore((state) => state.loaded);
  const worksLoading = useWorkStore((state) => state.loading);
  const worksError = useWorkStore((state) => state.error);
  const refreshWorks = useWorkStore((state) => state.refreshWorks);
  const runningRuntimeAppIds = useProductAppRuntimeStore((state) => state.runningWorkerIds);
  const recentRuntimeAppIds = useProductAppRuntimeStore((state) => state.recentAppIds);
  const pinnedAppIds = useAppsStore((state) => state.pinnedAppIds);

  const catalog = useHubPreviewResource<ProductAppLibrary>(
    'workspace-hub:apps:system-catalog',
    () => appCatalogAPI.listProductAppLibrary(),
    { ttlMs: 30_000 },
  );

  useEffect(() => {
    if (!worksLoaded && !worksLoading) void refreshWorks();
  }, [refreshWorks, worksLoaded, worksLoading]);

  const continuableWorks = useMemo(() => works
    .map((work) => ({ work, appRef: appRefFromWork(work) }))
    .filter((item): item is { work: WorkRecord; appRef: WorkAppRef } => (
      Boolean(item.appRef) && CONTINUABLE_STATUSES.has(item.work.status)
    ))
    .sort((left, right) => right.work.updatedAt - left.work.updatedAt), [works]);

  const installedApps = useMemo(
    () => localizeCatalogApps(catalog.data?.installed ?? [], currentLanguage)
      .filter((app) => app.enabled && app.catalogVisibility !== 'hidden'),
    [catalog.data?.installed, currentLanguage],
  );
  const discoverApps = useMemo(
    () => localizeCatalogApps(catalog.data?.discoverable ?? [], currentLanguage)
      .filter((app) => app.installed !== true && app.catalogVisibility !== 'hidden'),
    [catalog.data?.discoverable, currentLanguage],
  );
  const appById = useMemo(
    () => new Map(installedApps.map((app) => [app.appId, app])),
    [installedApps],
  );
  const installedAppBySurfaceId = useMemo(
    () => new Map(installedApps.map((app) => [app.id, app])),
    [installedApps],
  );
  const runningRuntimeIdSet = useMemo(
    () => new Set(runningRuntimeAppIds),
    [runningRuntimeAppIds],
  );
  const workAppIds = useMemo(
    () => new Set(continuableWorks.map(({ appRef }) => appRef.appId)),
    [continuableWorks],
  );
  const runningAppsWithoutWork = useMemo(
    () => installedApps.filter((app) => (
      runningRuntimeIdSet.has(app.id) && !workAppIds.has(app.appId)
    )),
    [installedApps, runningRuntimeIdSet, workAppIds],
  );
  const activityItems = useMemo<AppActivityItem[]>(() => [
    ...continuableWorks.map((item) => ({ kind: 'work' as const, ...item })),
    ...runningAppsWithoutWork.map((app) => ({ kind: 'app' as const, app })),
  ], [continuableWorks, runningAppsWithoutWork]);
  const runningDockItems = useMemo(() => {
    const seenAppIds = new Set<string>();
    return activityItems.filter((item) => {
      const running = item.kind === 'app' || item.work.status === 'running';
      const appId = item.kind === 'app' ? item.app.appId : item.appRef.appId;
      if (!running || seenAppIds.has(appId)) return false;
      seenAppIds.add(appId);
      return true;
    }).slice(0, 4);
  }, [activityItems]);
  const recentApps = useMemo(
    () => recentRuntimeAppIds
      .map((id) => installedAppBySurfaceId.get(id))
      .filter((app): app is ProductAppCatalogEntry => Boolean(app)),
    [installedAppBySurfaceId, recentRuntimeAppIds],
  );
  const pinnedApps = useMemo(
    () => pinnedAppIds
      .map((id) => installedApps.find((app) => app.appId === id || app.id === id))
      .filter((app): app is ProductAppCatalogEntry => Boolean(app)),
    [installedApps, pinnedAppIds],
  );
  const visibleApps = useMemo(() => {
    const candidates = [...pinnedApps, ...recentApps, ...installedApps, ...discoverApps];
    const selected: ProductAppCatalogEntry[] = [];
    const selectedAppIds = new Set<string>();

    for (const app of candidates) {
      if (selected.length >= 8) break;
      if (selectedAppIds.has(app.appId)) continue;
      selected.push(app);
      selectedAppIds.add(app.appId);
    }

    return selected;
  }, [discoverApps, installedApps, pinnedApps, recentApps]);

  const openAppCenter = useCallback(() => {
    useAppsStore.getState().openHome();
    onOpenItem('apps');
  }, [onOpenItem]);

  const openAppDetails = useCallback((appId: string) => {
    useAppsStore.getState().openAppDetail(appId);
    onOpenItem('apps');
  }, [onOpenItem]);

  const handleOpenWork = useCallback((work: WorkRecord) => {
    onClose();
    void openWork(work).catch((error) => {
      log.error('Failed to open app work from Workspace Hub', { workId: work.id, error });
    });
  }, [onClose]);

  const handleOpenApp = useCallback((app: ProductAppCatalogEntry) => {
    if (!app.activeRef || catalogAppRequiresWorkspace(app)) {
      openAppDetails(app.id);
      return;
    }

    onClose();
    void launchActiveIntelligentApp(app.activeRef, {
      scope: appScopeFromWorkspace(lastUsedWorkspace) ?? systemAppScope(),
      title: app.name,
      objective: app.description || app.name,
    }).catch((error) => {
      log.error('Failed to launch app from Workspace Hub', { appId: app.id, error });
      useAppsStore.getState().openAppDetail(app.id);
      onOpenItem('apps');
    });
  }, [lastUsedWorkspace, onClose, onOpenItem, openAppDetails]);

  const handleCreateApp = useCallback(() => {
    onClose();
    void createAndOpenAppBuilder({
      scope: appScopeFromWorkspace(lastUsedWorkspace) ?? systemAppScope(),
    }).catch((error) => {
      log.error('Failed to create app from Workspace Hub', { error });
    });
  }, [lastUsedWorkspace, onClose]);

  const handleOpenActivity = useCallback((item: AppActivityItem) => {
    if (item.kind === 'app') {
      handleOpenApp(item.app);
      return;
    }
    handleOpenWork(item.work);
  }, [handleOpenApp, handleOpenWork]);

  const activityTitle = useCallback((item: AppActivityItem) => (
    item.kind === 'app' ? item.app.name : item.work.title
  ), []);

  const renderActivityIcon = useCallback((item: AppActivityItem, size: number) => {
    if (item.kind === 'app') return <AppIcon app={item.app} size={size} />;
    const app = appById.get(item.appRef.appId);
    return app ? <AppIcon app={app} size={size} /> : <Workflow size={Math.round(size * 0.7)} />;
  }, [appById]);

  const initialLoading = (!worksLoaded && !worksError) || (catalog.loading && !catalog.data);

  return (
    <WorkspaceHubPreviewFrame
      className="sparo-workspace-hub-apps-preview"
      title={label}
      headerMeta={(
        <div className="sparo-workspace-hub-apps-preview__header-actions">
          <IconButton
            variant="ghost"
            size="medium"
            shape="circle"
            aria-label={t('nav.menuPanel.hub.preview.apps.actions.create')}
            tooltip={t('nav.menuPanel.hub.preview.apps.actions.create')}
            tooltipPlacement="top"
            onClick={handleCreateApp}
          >
            <Plus size={16} aria-hidden="true" />
          </IconButton>
          <IconButton
            ref={primaryActionRef}
            variant="brand"
            size="medium"
            shape="circle"
            aria-label={t('nav.menuPanel.hub.preview.apps.actions.open')}
            tooltip={t('nav.menuPanel.hub.preview.apps.actions.open')}
            tooltipPlacement="top"
            onClick={openAppCenter}
          >
            <LayoutGrid size={16} aria-hidden="true" />
          </IconButton>
        </div>
      )}
    >
      <div className="sparo-workspace-hub-apps-preview__running-section">
        {initialLoading ? (
          <WorkspaceHubPreviewLoading rows={1} />
        ) : worksError && !runningDockItems.length ? (
          <WorkspaceHubPreviewError
            message={t('nav.menuPanel.hub.preview.apps.errors.works')}
            retryLabel={t('nav.menuPanel.hub.preview.common.retry')}
            onRetry={() => { void refreshWorks(); }}
          />
        ) : runningDockItems.length ? (
          <div
            className="sparo-workspace-hub-apps-preview__running-dock"
            role="list"
            aria-label={t('nav.menuPanel.hub.preview.apps.aria.runningApps')}
          >
            {runningDockItems.map((item) => {
              const title = activityTitle(item);
              const key = item.kind === 'app' ? `app:${item.app.id}` : `work:${item.work.id}`;
              return (
                <span
                  key={key}
                  className="sparo-workspace-hub-apps-preview__running-item"
                  role="listitem"
                >
                  <IconButton
                    variant="ghost"
                    size="large"
                    shape="circle"
                    aria-label={t('nav.menuPanel.hub.preview.apps.aria.openRunningApp', { name: title })}
                    tooltip={title}
                    tooltipPlacement="bottom"
                    onClick={() => handleOpenActivity(item)}
                  >
                    {renderActivityIcon(item, 26)}
                  </IconButton>
                  <span className="sparo-workspace-hub-apps-preview__running-indicator" aria-hidden="true" />
                </span>
              );
            })}
          </div>
        ) : (
          <WorkspaceHubPreviewEmpty
            title={t('nav.menuPanel.hub.preview.apps.empty.runningTitle')}
          />
        )}
      </div>

      <div className="sparo-workspace-hub-apps-preview__apps-grid-section">
        <WorkspaceHubPreviewSection
          title={t('nav.menuPanel.hub.preview.apps.sections.apps')}
          className="sparo-workspace-hub-apps-preview__apps-section"
          meta={t('nav.menuPanel.hub.preview.common.count', { count: visibleApps.length })}
        >
          {catalog.loading && !catalog.data ? (
            <WorkspaceHubPreviewLoading rows={2} />
          ) : catalog.error && !catalog.data ? (
            <WorkspaceHubPreviewError
              message={t('nav.menuPanel.hub.preview.apps.errors.catalog')}
              retryLabel={t('nav.menuPanel.hub.preview.common.retry')}
              onRetry={catalog.refresh}
            />
          ) : visibleApps.length ? (
            <div
              className="sparo-workspace-hub-apps-preview__quick-grid"
              role="list"
              aria-label={t('nav.menuPanel.hub.preview.apps.aria.apps')}
            >
              {visibleApps.map((app) => {
              const installed = app.installed === true;
              return (
                <Button
                  key={`${app.id}@${app.version}`}
                  variant="ghost"
                  size="small"
                  className="sparo-workspace-hub-apps-preview__quick-card"
                  role="listitem"
                  aria-label={t('nav.menuPanel.hub.preview.apps.aria.openApp', { name: app.name })}
                  onClick={() => installed ? handleOpenApp(app) : openAppDetails(app.id)}
                >
                  <AppIcon app={app} size={40} />
                  <span>{app.name}</span>
                </Button>
              );
              })}
            </div>
          ) : (
            <WorkspaceHubPreviewEmpty
              title={t('nav.menuPanel.hub.preview.apps.empty.appsTitle')}
            />
          )}
        </WorkspaceHubPreviewSection>
      </div>
    </WorkspaceHubPreviewFrame>
  );
};

export default AppsPreview;
