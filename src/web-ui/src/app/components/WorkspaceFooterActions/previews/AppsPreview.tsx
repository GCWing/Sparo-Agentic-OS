import React, { useCallback, useEffect, useMemo } from 'react';
import { LayoutGrid, Plus, Workflow } from 'lucide-react';
import { Button, IconButton } from '@/design-system';
import { useWorkStore } from '@/app/agentic-os/work/data/workStore';
import { productAppWorkRef, sameProductAppRef } from '@/app/agentic-os/work/domain/productAppRefs';
import type { WorkRecord } from '@/app/agentic-os/work/domain/workTypes';
import {
  catalogAppLaunchRequiresWorkConfirmation,
  getCatalogAppLaunchBehavior,
} from '@/app/agentic-os/work/domain/productAppLaunchPolicy';
import { openWork } from '@/app/agentic-os/work/navigation/openWork';
import { productAppWorkChoice } from '@/app/components/WorkDock/NewWorkDialog';
import { AppIcon } from '@/app/components/AppIcon';
import { useAppsStore } from '@/app/scenes/apps/appsStore';
import { createAndOpenAppBuilder } from '@/app/scenes/apps/app-builder/openAppBuilderSession';
import { launchActiveIntelligentApp } from '@/app/scenes/apps/intelligentAppLaunchService';
import { useProductAppRuntimeStore } from '@/app/scenes/apps/product-app-runtime/productAppRuntimeStore';
import { NATIVE_SYSTEM_APP_CATALOG } from '@/app/scenes/apps/nativeSystemCatalog';
import {
  selectDistinctOpenAppWorkActivities,
  selectOpenAppWorkActivities,
  type AppWorkActivity,
} from '@/app/scenes/apps/appWorkActivity';
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

const AppsPreview: React.FC<WorkspaceHubPreviewProps> = ({
  label,
  primaryActionRef,
  onOpenItem,
  onCreateWork,
  onClose,
}) => {
  const { t, currentLanguage } = useI18n('common');
  const { lastUsedWorkspace } = useWorkspaceContext();
  const works = useWorkStore((state) => state.works);
  const worksLoaded = useWorkStore((state) => state.loaded);
  const worksLoading = useWorkStore((state) => state.loading);
  const worksError = useWorkStore((state) => state.error);
  const refreshWorks = useWorkStore((state) => state.refreshWorks);
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

  const continuableWorks = useMemo(() => selectOpenAppWorkActivities(works), [works]);

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
  const nativeAppById = useMemo(
    () => new Map(
      localizeCatalogApps(NATIVE_SYSTEM_APP_CATALOG, currentLanguage)
        .map((app) => [app.id, app]),
    ),
    [currentLanguage],
  );
  const installedAppBySurfaceId = useMemo(
    () => new Map(installedApps.map((app) => [app.id, app])),
    [installedApps],
  );
  const runningDockItems = useMemo(
    () => selectDistinctOpenAppWorkActivities(continuableWorks, 4),
    [continuableWorks],
  );
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
    if (!app.activeRef) {
      openAppDetails(app.id);
      return;
    }

    const launchBehavior = getCatalogAppLaunchBehavior(app);
    if (!launchBehavior.supportsMultipleWorks) {
      const appRef = productAppWorkRef(app.activeRef);
      const existingWork = continuableWorks.find((item) => (
        sameProductAppRef(item.appRef, appRef)
      ));
      if (existingWork) {
        handleOpenWork(existingWork.work);
        return;
      }
    }

    if (catalogAppLaunchRequiresWorkConfirmation(app)) {
      onCreateWork(productAppWorkChoice(app.slotId));
      return;
    }

    onClose();
    void launchActiveIntelligentApp(app.activeRef, {
      scope: systemAppScope(),
      title: app.name,
      objective: app.description || app.name,
    }).catch((error) => {
      log.error('Failed to launch app from Workspace Hub', { appId: app.id, error });
      useAppsStore.getState().openAppDetail(app.id);
      onOpenItem('apps');
    });
  }, [continuableWorks, handleOpenWork, onClose, onCreateWork, onOpenItem, openAppDetails]);

  const handleCreateApp = useCallback(() => {
    onClose();
    void createAndOpenAppBuilder({
      scope: appScopeFromWorkspace(lastUsedWorkspace) ?? systemAppScope(),
    }).catch((error) => {
      log.error('Failed to create app from Workspace Hub', { error });
    });
  }, [lastUsedWorkspace, onClose]);

  const renderActivityIcon = useCallback((item: AppWorkActivity, size: number) => {
    const app = item.appRef.kind === 'native_app'
      ? nativeAppById.get(item.appRef.appId)
      : appById.get(item.appRef.appId);
    return app ? <AppIcon app={app} size={size} /> : <Workflow size={Math.round(size * 0.7)} />;
  }, [appById, nativeAppById]);

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
              const title = item.work.title;
              return (
                <span
                  key={`work:${item.work.id}`}
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
                    onClick={() => handleOpenWork(item.work)}
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
