/**
 * AppsScene — unified application hub.
 *
 * Layout (centered, max-width 860px):
 *   hero (title + subtitle)
 *   search bar
 *   carousel  ← global featured banner, always visible on home
 *   [Agent App] [Live App] [Bridge App]  ← tab pills below carousel
 *   list  ← 2×4 grid per page with pagination (8 items max per page)
 *
 * Clicking a row:
 *   Mode Agent App → app overview (`ModeAppDetailView`) → per-agent Agent detail (tools / skills).
 *   Standalone Agent App → same overview first, then agent detail.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Cable,
  ChevronLeft,
  ChevronRight,
  Cpu,
  FolderPlus,
  LayoutGrid,
  PencilRuler,
  Play,
  Plus,
  RefreshCw,
  Search as SearchIcon,
  Sparkles,
  Square,
  Tag,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, ConfirmDialog, Search } from '@/component-library';
import { GalleryDetailModal } from '@/app/components';
import { open } from '@tauri-apps/plugin-dialog';
import { liveAppAPI } from '@/infrastructure/api/service-api/LiveAppAPI';
import type { LiveAppMeta } from '@/infrastructure/api/service-api/LiveAppAPI';
import { useOverlayManager } from '@/app/hooks/useOverlayManager';
import { useOverlayStore } from '@/app/stores/overlayStore';
import type { OverlaySceneId } from '@/app/overlay/types';
import { useLastUsedWorkspace, useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import { createLogger } from '@/shared/utils/logger';
import { useGallerySceneAutoRefresh } from '@/app/hooks/useGallerySceneAutoRefresh';
import { notificationService } from '@/shared/notification-system';
import { launchSessionForChoice } from '@/app/components/SessionCapsule/NewSessionDialog';
import { getStandaloneAppRowMeta } from './appsUtils';
import { useAppsStore, type AppsTab } from './appsStore';
import { useAppsData } from './hooks/useAppsData';
import type { AppCardModel } from './hooks/useAppsData';
import { useLiveAppStore } from './live-app/liveAppStore';
import { useLiveAppCatalogSync } from './live-app/hooks/useLiveAppCatalogSync';
import LiveAppRuntimeBadges from './live-app/components/LiveAppRuntimeBadges';
import {
  buildLiveAppRuntimeSummary,
  summarizeLiveAppPermissions,
} from './live-app/liveAppRuntimeModel';
import { renderLiveAppIcon, getLiveAppIconGradient } from './live-app/liveAppIconHelpers';
import { ModeAppDetailView, AgentDetailView } from './sections/AgentAppDetailViews';
import './AppsScene.scss';

const log = createLogger('AppsScene');
const TAB_KEYS: AppsTab[] = ['agent-app', 'live-app', 'bridge-app'];
/** Main list: 2 columns × 4 rows per page. */
const LIST_PAGE_SIZE = 8;
type AppsData = ReturnType<typeof useAppsData>;

function appName(app: AppCardModel, t: (key: string, options?: Record<string, unknown>) => string): string {
  return app.dynamicName ?? t(app.nameKey);
}

function appDescription(app: AppCardModel, t: (key: string, options?: Record<string, unknown>) => string): string {
  return app.dynamicDescription ?? t(app.descriptionKey);
}

function formatUpdatedAt(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

const AppsListSkeleton: React.FC<{
  rowCount?: number;
  showActions?: boolean;
}> = ({ rowCount = LIST_PAGE_SIZE, showActions = false }) => (
  <div className="apps-scene__list apps-scene__list--skeleton" aria-busy="true">
    {Array.from({ length: rowCount }).map((_, index) => (
      <div
        key={`apps-row-skeleton-${index}`}
        className="apps-list-row apps-list-row--skeleton"
        style={{ '--row-index': index } as React.CSSProperties}
      >
        <div className="apps-list-row__sk-icon" />
        <div className="apps-list-row__sk-body">
          <div className="apps-list-row__sk-head">
            <div className="apps-list-row__sk-line apps-list-row__sk-line--name is-animated" />
            <div className="apps-list-row__sk-pill" />
          </div>
          <div className="apps-list-row__sk-line apps-list-row__sk-line--desc is-animated" />
          <div className="apps-list-row__sk-line apps-list-row__sk-line--meta" />
        </div>
        {showActions ? (
          <div className="apps-list-row__sk-actions">
            <div className="apps-list-row__sk-action" />
            <div className="apps-list-row__sk-action" />
          </div>
        ) : (
          <div className="apps-list-row__sk-chevron" />
        )}
      </div>
    ))}
  </div>
);

const AppsListPagination: React.FC<{
  pageIndex: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}> = ({ pageIndex, totalPages, onPrev, onNext }) => {
  const { t } = useTranslation('scenes/apps');
  if (totalPages <= 1) return null;
  return (
    <div className="apps-scene__list-pagination" role="navigation" aria-label={t('page.pagination.ariaLabel')}>
      <button
        type="button"
        className="apps-scene__list-page-btn"
        disabled={pageIndex <= 0}
        onClick={onPrev}
        aria-label={t('page.pagination.prev')}
      >
        <ChevronLeft size={16} />
      </button>
      <span className="apps-scene__list-page-indicator">
        {t('page.pagination.pageOf', { current: pageIndex + 1, total: totalPages })}
      </span>
      <button
        type="button"
        className="apps-scene__list-page-btn"
        disabled={pageIndex >= totalPages - 1}
        onClick={onNext}
        aria-label={t('page.pagination.next')}
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// App Carousel  (global featured banner, always on home)
// ─────────────────────────────────────────────────────────────────────────────

const AppCarousel: React.FC<{
  apps: AppCardModel[];
  onNavigateApp: (app: AppCardModel) => void;
}> = ({ apps, onNavigateApp }) => {
  const { t } = useTranslation('scenes/apps');
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const count = apps.length;

  const go = useCallback((idx: number) => setActive(((idx % count) + count) % count), [count]);

  useEffect(() => {
    if (hovered || count <= 1) return;
    timerRef.current = setTimeout(() => go(active + 1), 3200);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [active, hovered, go, count]);

  const app = apps[active];
  const Icon = app.kind === 'mode-app' ? Cpu : Bot;

  return (
    <div
      className="app-carousel"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Sparo OS VI: a single quiet orbit + print-red ignition node */}
      <svg
        className="app-carousel__orbit"
        viewBox="-230 -230 460 460"
        aria-hidden
        focusable="false"
      >
        <circle className="app-carousel__orbit-ring" r="120" />
        <circle className="app-carousel__orbit-ring--dashed" r="180" />
        {/* Short print-red arc — the only saturated mark */}
        <path className="app-carousel__orbit-arc" d="M120 -22 A 122 122 0 0 1 96 78" />
        {/* Ignition node + pulsing ring (centered) */}
        <circle className="app-carousel__orbit-node--print" cx="0" cy="0" r="4" />
        <circle className="app-carousel__orbit-node-ring" cx="0" cy="0" r="9" />
      </svg>

      <button type="button" className="app-carousel__card" onClick={() => onNavigateApp(app)}>
        <div className="app-carousel__left">
          <span className="app-carousel__icon-wrap">
            <Icon size={28} strokeWidth={1.4} />
          </span>
          <div className="app-carousel__text">
            <span className="app-carousel__name">{appName(app, t)}</span>
            <span className="app-carousel__desc">{appDescription(app, t)}</span>
          </div>
        </div>
        <span className="app-carousel__badge">{t(app.badgeKey)}</span>
      </button>

      {count > 1 && (
        <div className="app-carousel__controls">
          <button
            type="button"
            className="app-carousel__arrow"
            onClick={(e) => { e.stopPropagation(); go(active - 1); }}
            aria-label={t('hero.carousel.prev', { defaultValue: '上一个' })}
          >
            <ChevronLeft size={14} />
          </button>
          <div className="app-carousel__dots">
            {apps.map((_, i) => (
              <button
                key={i}
                type="button"
                className={`app-carousel__dot${i === active ? ' is-active' : ''}`}
                onClick={(e) => { e.stopPropagation(); go(i); }}
                aria-label={t('hero.carousel.goto', { defaultValue: '切换到第 {{n}} 项', n: i + 1 })}
              />
            ))}
          </div>
          <button
            type="button"
            className="app-carousel__arrow"
            onClick={(e) => { e.stopPropagation(); go(active + 1); }}
            aria-label={t('hero.carousel.next', { defaultValue: '下一个' })}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Agent App list row
// ─────────────────────────────────────────────────────────────────────────────

const AgentAppRow: React.FC<{
  app: AppCardModel;
  onNavigate: (app: AppCardModel) => void;
}> = ({ app, onNavigate }) => {
  const { t } = useTranslation('scenes/apps');
  const Icon = app.kind === 'mode-app' ? Cpu : Bot;
  const isMode = app.kind === 'mode-app';

  return (
    <button type="button" className="apps-list-row" onClick={() => onNavigate(app)}>
      <span className="apps-list-row__icon apps-list-row__icon--agent"><Icon size={18} /></span>
      <span className="apps-list-row__body">
        <span className="apps-list-row__head">
          <span className="apps-list-row__name">{appName(app, t)}</span>
          <Badge variant={isMode ? 'accent' : 'purple'}>{t(app.badgeKey)}</Badge>
        </span>
        <span className="apps-list-row__desc">{appDescription(app, t)}</span>
        <span className="apps-list-row__meta">
          {isMode
            ? t('page.containsAgents', { count: app.includedAgents.length })
            : app.includedAgents[0]
              ? getStandaloneAppRowMeta(app.includedAgents[0], t)
              : ''}
        </span>
      </span>
      <span className="apps-list-row__chev"><ChevronRight size={14} /></span>
    </button>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Live App list row
// ─────────────────────────────────────────────────────────────────────────────

const LiveAppRow: React.FC<{
  app: LiveAppMeta;
  isOpen: boolean;
  isRunning: boolean;
  runtimeAvailable: boolean;
  onOpenDetails: (app: LiveAppMeta) => void;
  onOpen: (id: string) => void;
  onInstallDeps: (id: string) => Promise<void>;
  onRecompile: (id: string) => Promise<void>;
  onSyncFromFs: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onDelete: (id: string) => void;
}> = ({
  app,
  isOpen,
  isRunning,
  runtimeAvailable,
  onOpenDetails,
  onOpen,
  onInstallDeps,
  onRecompile,
  onSyncFromFs,
  onStop,
  onDelete,
}) => {
  const { t } = useTranslation('scenes/apps');
  const summary = buildLiveAppRuntimeSummary(app, {
    isOpen,
    isRunning,
    runtimeStatus: { available: runtimeAvailable },
  });
  const primaryTitle = summary.depsDirty
    ? t('liveApp.actions.installDeps')
    : summary.workerRestartRequired
      ? t('liveApp.actions.restartWorker')
      : !summary.runtimeAvailable
        ? t('liveApp.actions.openAnyway')
        : t('liveApp.card.start');

  return (
    <div
      className={`apps-list-row apps-list-row--live${summary.isRunning ? ' is-running' : ''}${summary.hasAttention ? ' has-attention' : ''}`}
      onClick={() => onOpenDetails(app)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpenDetails(app)}
    >
      <span className="apps-list-row__icon apps-list-row__icon--live">
        {renderLiveAppIcon(app.icon || 'live-app', 18)}
      </span>
      <span className="apps-list-row__body">
        <span className="apps-list-row__head">
          <span className="apps-list-row__name">{app.name}</span>
          {summary.isRunning && <span className="apps-list-row__run-dot" />}
          <span className="apps-list-row__version">v{app.version}</span>
        </span>
        {app.description ? <span className="apps-list-row__desc">{app.description}</span> : null}
        <LiveAppRuntimeBadges summary={summary} t={t} className="apps-list-row__runtime" />
      </span>
      <div className="apps-list-row__actions" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="apps-list-row__action apps-list-row__action--primary"
          onClick={() => {
            if (summary.depsDirty) {
              void onInstallDeps(app.id);
              return;
            }
            void onOpen(app.id);
          }}
          title={primaryTitle}
        >
          {summary.depsDirty ? <RefreshCw size={13} /> : <Play size={13} fill="currentColor" strokeWidth={0} />}
        </button>
        {summary.isRunning ? (
          <button type="button" className="apps-list-row__action apps-list-row__action--stop"
            onClick={() => void onStop(app.id)} title={t('liveApp.card.stop')}>
            <Square size={12} />
          </button>
        ) : summary.workerRestartRequired ? (
          <button type="button" className="apps-list-row__action apps-list-row__action--stop"
            onClick={() => void onOpen(app.id)} title={t('liveApp.actions.restartWorker')}>
            <Play size={12} fill="currentColor" strokeWidth={0} />
          </button>
        ) : (
          <button type="button" className="apps-list-row__action"
            onClick={() => void onSyncFromFs(app.id)} title={t('liveApp.actions.syncFromFs')}>
            <RefreshCw size={12} />
          </button>
        )}
        {!summary.isRunning && !summary.workerRestartRequired ? (
          <button type="button" className="apps-list-row__action apps-list-row__action--danger"
            onClick={() => onDelete(app.id)} title={t('liveApp.card.delete')}>
            <Trash2 size={12} />
          </button>
        ) : null}
        <button type="button" className="apps-list-row__action"
          onClick={() => void onRecompile(app.id)} title={t('liveApp.actions.recompile')}>
          <RefreshCw size={12} />
        </button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Home view
// ─────────────────────────────────────────────────────────────────────────────

const AppsHomeView: React.FC<{
  appsData: AppsData;
}> = ({ appsData }) => {
  const { t } = useTranslation('scenes/apps');
  const { activeTab, setActiveTab, searchQuery, setSearchQuery, openAppDetail } = useAppsStore();

  const { appCards, loading: agentLoading } = appsData;

  // Live App state
  const liveApps         = useLiveAppStore((s) => s.apps);
  const liveLoading      = useLiveAppStore((s) => s.loading);
  const runtimeStatus    = useLiveAppStore((s) => s.runtimeStatus);
  const openedAppIds     = useLiveAppStore((s) => s.openedAppIds);
  const runningWorkerIds = useLiveAppStore((s) => s.runningWorkerIds);
  const setLiveApps      = useLiveAppStore((s) => s.setApps);
  const setLiveLoading   = useLiveAppStore((s) => s.setLoading);
  const setRuntimeStatus = useLiveAppStore((s) => s.setRuntimeStatus);
  const setRunningIds    = useLiveAppStore((s) => s.setRunningWorkerIds);
  const markStopped      = useLiveAppStore((s) => s.markWorkerStopped);

  const { workspacePath } = useLastUsedWorkspace();
  const { rememberWorkspace } = useWorkspaceContext();
  const { openOverlay, activeOverlay } = useOverlayManager();

  const [liveSearch, setLiveSearch]           = useState('');
  const [selectedLiveApp, setSelectedLiveApp] = useState<LiveAppMeta | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const runningIdSet = useMemo(() => new Set(runningWorkerIds), [runningWorkerIds]);
  const openedIdSet = useMemo(() => new Set(openedAppIds), [openedAppIds]);
  const openTabIds   = useMemo(() => new Set(activeOverlay ? [activeOverlay] : []), [activeOverlay]);

  const filteredLiveApps = useMemo(() => {
    const q = liveSearch.toLowerCase();
    return liveApps.filter((app) =>
      !q ||
      app.name.toLowerCase().includes(q) ||
      app.description.toLowerCase().includes(q) ||
      app.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [liveApps, liveSearch]);

  // Filtered agent apps
  const filteredAgentApps = useMemo(() => {
    const q = searchQuery.toLowerCase();
    if (!q) return appCards;
    return appCards.filter((app) =>
      app.id.toLowerCase().includes(q) ||
      app.includedAgents.some((a) => a.name.toLowerCase().includes(q)),
    );
  }, [appCards, searchQuery]);

  const [listPage, setListPage] = useState(0);

  useEffect(() => {
    setListPage(0);
  }, [activeTab, searchQuery, liveSearch]);

  const agentListTotalPages = Math.max(1, Math.ceil(filteredAgentApps.length / LIST_PAGE_SIZE));
  const liveListTotalPages = Math.max(1, Math.ceil(filteredLiveApps.length / LIST_PAGE_SIZE));

  useEffect(() => {
    if (activeTab !== 'agent-app' && activeTab !== 'live-app') return;
    const total = activeTab === 'agent-app' ? agentListTotalPages : liveListTotalPages;
    setListPage((p) => Math.min(p, total - 1));
  }, [activeTab, agentListTotalPages, liveListTotalPages]);

  const pagedAgentApps = useMemo(() => {
    const start = listPage * LIST_PAGE_SIZE;
    return filteredAgentApps.slice(start, start + LIST_PAGE_SIZE);
  }, [filteredAgentApps, listPage]);

  const pagedLiveApps = useMemo(() => {
    const start = listPage * LIST_PAGE_SIZE;
    return filteredLiveApps.slice(start, start + LIST_PAGE_SIZE);
  }, [filteredLiveApps, listPage]);

  const selectedRuntimeSummary = useMemo(() => {
    if (!selectedLiveApp) return null;
    return buildLiveAppRuntimeSummary(selectedLiveApp, {
      isOpen: openedIdSet.has(selectedLiveApp.id),
      isRunning: runningIdSet.has(selectedLiveApp.id),
      runtimeStatus,
    });
  }, [openedIdSet, runningIdSet, runtimeStatus, selectedLiveApp]);

  const selectedPermissionSummary = useMemo(() => {
    return selectedLiveApp ? summarizeLiveAppPermissions(selectedLiveApp.permissions) : null;
  }, [selectedLiveApp]);

  const handleOpenLiveApp = (appId: string) => {
    setSelectedLiveApp(null);
    openOverlay(`live-app:${appId}` as OverlaySceneId);
  };

  const handleOpenStudio = useCallback(async () => {
    try {
      await launchSessionForChoice({
        agentChoice: 'LiveAppStudio',
        workspace: null,
        rememberWorkspace,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      notificationService.error(`${t('liveApp.openStudio')}: ${reason}`);
    }
  }, [rememberWorkspace, t]);

  const handleOpenAgentAppStudio = useCallback(async () => {
    try {
      await launchSessionForChoice({
        agentChoice: 'AgentAppStudio',
        workspace: null,
        rememberWorkspace,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      notificationService.error(`${t('page.newAgentApp')}: ${reason}`);
    }
  }, [rememberWorkspace, t]);

  const handleInstallDeps = useCallback(async (appId: string) => {
    try {
      setLiveLoading(true);
      const result = await liveAppAPI.installDeps(appId);
      if (!result.success) {
        notificationService.error(result.stderr || result.stdout || t('liveApp.messages.installDepsFailedGeneric'));
        return;
      }
      notificationService.success(t('liveApp.messages.installDepsOk'), { duration: 2500 });
      const apps = await liveAppAPI.listLiveApps();
      setLiveApps(apps);
    } catch (error) {
      notificationService.error(
        t('liveApp.messages.installDepsFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setLiveLoading(false);
    }
  }, [setLiveApps, setLiveLoading, t]);

  const handleRecompile = useCallback(async (appId: string) => {
    try {
      await liveAppAPI.recompile(appId, undefined, workspacePath || undefined);
      notificationService.success(t('liveApp.messages.recompiled'), { duration: 2200 });
    } catch (error) {
      notificationService.error(
        t('liveApp.messages.recompileFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }, [t, workspacePath]);

  const handleSyncFromFs = useCallback(async (appId: string) => {
    try {
      setLiveLoading(true);
      const app = await liveAppAPI.syncFromFs(appId, undefined, workspacePath || undefined);
      setLiveApps(liveApps.map((item) => item.id === app.id ? app : item));
      notificationService.success(t('liveApp.messages.syncedFromFs'), { duration: 2200 });
      if (selectedLiveApp?.id === app.id) {
        setSelectedLiveApp(app);
      }
    } catch (error) {
      notificationService.error(
        t('liveApp.messages.syncFromFsFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setLiveLoading(false);
    }
  }, [liveApps, selectedLiveApp?.id, setLiveApps, setLiveLoading, t, workspacePath]);

  const handleStopLiveApp = async (appId: string) => {
    const overlayId = `live-app:${appId}` as OverlaySceneId;
    try { await liveAppAPI.workerStop(appId); } catch (e) { log.warn('Stop failed', e); }
    finally {
      markStopped(appId);
      if (openTabIds.has(overlayId)) useOverlayStore?.getState().closeOverlay();
    }
  };

  const handleDeleteConfirm = async () => {
    if (!pendingDeleteId) return;
    const appId = pendingDeleteId;
    setPendingDeleteId(null);
    try {
      await liveAppAPI.deleteLiveApp(appId);
      if (selectedLiveApp?.id === appId) setSelectedLiveApp(null);
      setLiveApps(liveApps.filter((a) => a.id !== appId));
      markStopped(appId);
      const overlayId = `live-app:${appId}` as OverlaySceneId;
      if (openTabIds.has(overlayId)) useOverlayStore?.getState().closeOverlay();
    } catch (e) { log.error('Delete failed', e); }
  };

  const handleAddFromFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: t('liveApp.selectFolderTitle') });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path) return;
      setLiveLoading(true);
      const app = await liveAppAPI.importFromPath(path, workspacePath || undefined);
      setLiveApps([app, ...liveApps]);
      notificationService.success(
        t('liveApp.messages.imported', {
          name: app.name,
        }),
        { duration: 3200 },
      );
      handleOpenLiveApp(app.id);
    } catch (e) {
      log.error('Import failed', e);
      notificationService.error(
        t('liveApp.messages.importFailed', {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    }
    finally { setLiveLoading(false); }
  };

  const refetchLive = useCallback(async () => {
    setLiveLoading(true);
    try {
      const [apps, running, runtime] = await Promise.all([
        liveAppAPI.listLiveApps(),
        liveAppAPI.workerListRunning(),
        liveAppAPI.runtimeStatus(),
      ]);
      setLiveApps(apps);
      setRunningIds(running);
      setRuntimeStatus(runtime);
    } finally { setLiveLoading(false); }
  }, [setLiveApps, setLiveLoading, setRunningIds, setRuntimeStatus]);

  useGallerySceneAutoRefresh({ sceneId: 'apps', refetch: refetchLive });

  const effectiveSearch = activeTab === 'live-app' ? liveSearch : searchQuery;
  const onChangeSearch  = activeTab === 'live-app'
    ? (v: string) => setLiveSearch(v)
    : (v: string) => setSearchQuery(v);

  const handleNavigateAgentApp = useCallback(
    (app: AppCardModel) => {
      openAppDetail(app.id);
    },
    [openAppDetail],
  );

  return (
    <div className="apps-scene">
      <div className="apps-scene__scroll">
        <div className="apps-scene__scroll-inner">

        {/* ── Hero ─────────────────────────────────────────────── */}
        <header className="apps-scene__hero">
          <h1 className="apps-scene__hero-title">{t('hero.title')}</h1>
          <p className="apps-scene__hero-subtitle">{t('hero.subtitle')}</p>
          <div className="apps-scene__hero-toolbar">
            <Search
              className="apps-scene__hero-search"
              value={effectiveSearch}
              onChange={onChangeSearch}
              onClear={() => onChangeSearch('')}
              placeholder={t(`tabs.searchPlaceholder.${activeTab}`)}
              size="large"
              clearable
              prefixIcon={<SearchIcon size={13} />}
            />
          </div>
        </header>

        {/* ── Carousel — global, always on home ─────────────────── */}
        {agentLoading ? (
          <div className="app-carousel app-carousel--skeleton" aria-hidden="true" />
        ) : appCards.length > 0 ? (
          <AppCarousel apps={appCards} onNavigateApp={handleNavigateAgentApp} />
        ) : null}

        {/* ── Tab pills + list section ───────────────────────────── */}
        <section className="apps-scene__list-section">

              {/* Header: pills (left) + action button (right) */}
              <div className="apps-scene__list-header">
                <nav className="apps-scene__pills" role="tablist" aria-label={t('tabs.label')}>
                  {TAB_KEYS.map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === tab}
                      className={`apps-scene__pill${activeTab === tab ? ' is-active' : ''}`}
                      onClick={() => setActiveTab(tab)}
                    >
                      {t(`tabs.${tab}`)}
                    </button>
                  ))}
                </nav>

                {/* Per-tab action button, right-aligned */}
                {activeTab === 'agent-app' && (
                  <button type="button" className="apps-scene__list-action" onClick={handleOpenAgentAppStudio} title={t('page.newAgentApp')}>
                    <Plus size={14} />
                    <span>{t('page.newAgentApp')}</span>
                  </button>
                )}
                {activeTab === 'live-app' && (
                  <div className="apps-scene__list-actions">
                    <button
                      type="button"
                      className="apps-scene__list-action apps-scene__list-action--secondary"
                      onClick={handleOpenStudio}
                      title={t('liveApp.openStudio')}
                    >
                      <PencilRuler size={14} />
                      <span>{t('liveApp.openStudio')}</span>
                    </button>
                    <button
                      type="button"
                      className="apps-scene__list-action"
                      onClick={handleAddFromFolder}
                      disabled={liveLoading}
                      title={t('liveApp.importFromFolder')}
                    >
                      <FolderPlus size={14} />
                      <span>{t('liveApp.importFromFolder')}</span>
                    </button>
                    <button
                      type="button"
                      className="apps-scene__list-action apps-scene__list-action--secondary"
                      onClick={refetchLive}
                      disabled={liveLoading}
                      title={t('liveApp.actions.refreshCatalog')}
                    >
                      <RefreshCw size={14} />
                      <span>{t('liveApp.actions.refreshCatalog')}</span>
                    </button>
                  </div>
                )}
                {activeTab === 'bridge-app' && (
                  <button type="button" className="apps-scene__list-action" disabled title={t('bridgeApp.comingSoon')}>
                    <Plus size={14} />
                    <span>{t('page.newBridgeApp')}</span>
                  </button>
                )}
              </div>

              {/* Agent App list */}
              {activeTab === 'agent-app' && (
                agentLoading ? (
                  <AppsListSkeleton />
                ) : filteredAgentApps.length === 0 ? (
                  <div className="apps-scene__empty">
                    <Bot size={28} strokeWidth={1.5} />
                    <p>{t('page.empty')}</p>
                  </div>
                ) : (
                  <div className="apps-scene__list-block">
                    <div className="apps-scene__list">
                      {pagedAgentApps.map((app) => (
                        <AgentAppRow
                          key={app.id}
                          app={app}
                          onNavigate={handleNavigateAgentApp}
                        />
                      ))}
                    </div>
                    <AppsListPagination
                      pageIndex={listPage}
                      totalPages={agentListTotalPages}
                      onPrev={() => setListPage((p) => Math.max(0, p - 1))}
                      onNext={() => setListPage((p) => Math.min(agentListTotalPages - 1, p + 1))}
                    />
                  </div>
                )
              )}

              {/* Live App list */}
              {activeTab === 'live-app' && (
                liveLoading && liveApps.length === 0 ? (
                  <AppsListSkeleton showActions />
                ) : filteredLiveApps.length === 0 ? (
                  <div className="apps-scene__empty">
                    {liveApps.length === 0
                      ? <><Sparkles size={28} strokeWidth={1.5} /><p>{t('liveApp.empty.generate')}</p></>
                      : <><LayoutGrid size={28} strokeWidth={1.5} /><p>{t('liveApp.empty.noMatch')}</p></>}
                  </div>
                ) : (
                  <div className="apps-scene__list-block">
                    <div className="apps-scene__list">
                      {pagedLiveApps.map((app) => (
                        <LiveAppRow
                          key={app.id}
                          app={app}
                          isOpen={openedIdSet.has(app.id)}
                          isRunning={runningIdSet.has(app.id)}
                          runtimeAvailable={runtimeStatus?.available ?? false}
                          onOpenDetails={setSelectedLiveApp}
                          onOpen={handleOpenLiveApp}
                          onInstallDeps={handleInstallDeps}
                          onRecompile={handleRecompile}
                          onSyncFromFs={handleSyncFromFs}
                          onStop={handleStopLiveApp}
                          onDelete={setPendingDeleteId}
                        />
                      ))}
                    </div>
                    <AppsListPagination
                      pageIndex={listPage}
                      totalPages={liveListTotalPages}
                      onPrev={() => setListPage((p) => Math.max(0, p - 1))}
                      onNext={() => setListPage((p) => Math.min(liveListTotalPages - 1, p + 1))}
                    />
                  </div>
                )
              )}

              {/* Bridge App placeholder */}
              {activeTab === 'bridge-app' && (
                <div className="apps-scene__bridge-empty">
                  <Cable size={40} strokeWidth={1.2} />
                  <h3>{t('bridgeApp.title')}</h3>
                  <p>{t('bridgeApp.comingSoon')}</p>
                </div>
              )}
        </section>

        </div>
      </div>

      {/* ── Live App detail modal ──────────────────────────────────── */}
      <GalleryDetailModal
        isOpen={Boolean(selectedLiveApp)}
        onClose={() => setSelectedLiveApp(null)}
        icon={renderLiveAppIcon(selectedLiveApp?.icon || 'live-app', 24)}
        iconGradient={getLiveAppIconGradient(selectedLiveApp?.icon || 'live-app')}
        title={selectedLiveApp?.name ?? ''}
        badges={selectedLiveApp?.category ? <Badge variant="info">{selectedLiveApp.category}</Badge> : null}
        description={selectedLiveApp?.description}
        meta={selectedLiveApp ? <span>{t('liveApp.detail.versionMeta', { version: selectedLiveApp.version })}</span> : null}
        actions={selectedLiveApp ? (
          <>
            {selectedRuntimeSummary?.depsDirty ? (
              <Button variant="secondary" size="small" onClick={() => void handleInstallDeps(selectedLiveApp.id)}>
                <RefreshCw size={14} />{t('liveApp.actions.installDeps')}
              </Button>
            ) : null}
            {selectedRuntimeSummary?.isRunning ? (
              <Button variant="secondary" size="small" onClick={() => void handleStopLiveApp(selectedLiveApp.id)}>
                <Square size={14} />{t('liveApp.detail.stop')}
              </Button>
            ) : null}
            <Button variant="secondary" size="small" onClick={() => void handleRecompile(selectedLiveApp.id)}>
              <RefreshCw size={14} />{t('liveApp.actions.recompile')}
            </Button>
            <Button variant="secondary" size="small" onClick={() => void handleSyncFromFs(selectedLiveApp.id)}>
              <RefreshCw size={14} />{t('liveApp.actions.syncFromFs')}
            </Button>
            <Button variant="danger" size="small" onClick={() => setPendingDeleteId(selectedLiveApp.id)}>
              <Trash2 size={14} />{t('liveApp.detail.delete')}
            </Button>
            <Button variant="primary" size="small" onClick={() => handleOpenLiveApp(selectedLiveApp.id)}>
              <Play size={14} />
              {selectedRuntimeSummary?.runtimeAvailable ? t('liveApp.detail.open') : t('liveApp.actions.openAnyway')}
            </Button>
          </>
        ) : null}
      >
        {selectedRuntimeSummary ? (
          <LiveAppRuntimeBadges summary={selectedRuntimeSummary} t={t} className="apps-scene__detail-runtime" />
        ) : null}
        {selectedLiveApp ? (
          <div className="apps-scene__detail-grid">
            <div className="apps-scene__detail-section">
              <h4>{t('liveApp.detail.statusTitle')}</h4>
              <div className="apps-scene__detail-copy">
                <span>{t('liveApp.detail.updatedAt')}</span>
                <strong>{formatUpdatedAt(selectedLiveApp.updated_at)}</strong>
              </div>
              {selectedRuntimeSummary?.runtimeAvailable ? null : (
                <div className="apps-scene__detail-alert">
                  <AlertTriangle size={14} />
                  <span>{t('liveApp.detail.runtimeUnavailableHint')}</span>
                </div>
              )}
            </div>

            {selectedPermissionSummary ? (
              <div className="apps-scene__detail-section">
                <h4>{t('liveApp.detail.permissionsTitle')}</h4>
                <div className="apps-scene__detail-permissions">
                  <Badge variant={selectedPermissionSummary.readsWorkspace ? 'warning' : 'neutral'}>
                    {selectedPermissionSummary.readsWorkspace ? t('liveApp.permissions.readWorkspace') : t('liveApp.permissions.noWorkspaceRead')}
                  </Badge>
                  <Badge variant={selectedPermissionSummary.writesWorkspace ? 'warning' : 'neutral'}>
                    {selectedPermissionSummary.writesWorkspace ? t('liveApp.permissions.writeWorkspace') : t('liveApp.permissions.noWorkspaceWrite')}
                  </Badge>
                  <Badge variant={selectedPermissionSummary.shellEnabled ? 'warning' : 'neutral'}>
                    {selectedPermissionSummary.shellEnabled ? t('liveApp.permissions.shellEnabled') : t('liveApp.permissions.shellDisabled')}
                  </Badge>
                  <Badge variant={selectedPermissionSummary.netEnabled ? 'info' : 'neutral'}>
                    {selectedPermissionSummary.netEnabled ? t('liveApp.permissions.netEnabled') : t('liveApp.permissions.netDisabled')}
                  </Badge>
                  <Badge variant={selectedPermissionSummary.aiEnabled ? 'accent' : 'neutral'}>
                    {selectedPermissionSummary.aiEnabled ? t('liveApp.permissions.aiEnabled') : t('liveApp.permissions.aiDisabled')}
                  </Badge>
                  <Badge variant={selectedPermissionSummary.nodeEnabled ? 'warning' : 'neutral'}>
                    {selectedPermissionSummary.nodeEnabled ? t('liveApp.permissions.nodeEnabled') : t('liveApp.permissions.nodeDisabled')}
                  </Badge>
                </div>
                {selectedLiveApp.permission_rationale ? (
                  <p className="apps-scene__detail-rationale">{selectedLiveApp.permission_rationale}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {selectedLiveApp?.tags.length ? (
          <div className="apps-scene__detail-tags">
            {selectedLiveApp.tags.map((tag) => (
              <span key={tag} className="apps-scene__detail-tag"><Tag size={11} />{tag}</span>
            ))}
          </div>
        ) : null}
      </GalleryDetailModal>

      <ConfirmDialog
        isOpen={pendingDeleteId !== null}
        onClose={() => setPendingDeleteId(null)}
        onConfirm={handleDeleteConfirm}
        title={t('liveApp.confirmDelete.title', { name: liveApps.find((a) => a.id === pendingDeleteId)?.name ?? '' })}
        message={t('liveApp.confirmDelete.message', {
          impact:
            pendingDeleteId && (openedIdSet.has(pendingDeleteId) || runningIdSet.has(pendingDeleteId))
              ? t('liveApp.confirmDelete.impactOpenOrRunning')
              : t('liveApp.confirmDelete.impactIdle'),
        })}
        type="warning"
        confirmDanger
        confirmText={t('liveApp.confirmDelete.confirm')}
        cancelText={t('liveApp.confirmDelete.cancel')}
      />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────────────────────

const AppsScene: React.FC = () => {
  const { page, selectedAppId, selectedAgentId, openHome, openAppDetail, openAgentDetail } = useAppsStore();
  const searchQuery = useAppsStore((s) => s.searchQuery);
  useLiveAppCatalogSync();

  const appsData = useAppsData(searchQuery);
  const {
    availableTools, getAgentById, getAppById,
    getModeConfig, getModeSkills, handleResetTools, handleSetAgentEnabled, handleSetSkills, handleSetTools,
    loadAppsData,
  } = appsData;

  useGallerySceneAutoRefresh({ sceneId: 'apps', refetch: () => void loadAppsData() });

  const selectedApp   = useMemo(() => getAppById(selectedAppId),    [getAppById, selectedAppId]);
  const selectedAgent = useMemo(() => getAgentById(selectedAgentId), [getAgentById, selectedAgentId]);

  if (page === 'agent-detail' && selectedAgent) {
    return (
      <AgentDetailView
        agent={selectedAgent}
        app={selectedApp}
        availableTools={availableTools}
        getModeConfig={getModeConfig}
        getModeSkills={getModeSkills}
        onBack={() =>
          selectedApp && (selectedApp.kind === 'mode-app' || selectedApp.kind === 'standalone-agent-app')
            ? openAppDetail(selectedApp.id)
            : openHome()
        }
        handleSetTools={handleSetTools}
        handleResetTools={handleResetTools}
        handleSetAgentEnabled={handleSetAgentEnabled}
        handleSetSkills={handleSetSkills}
      />
    );
  }
  if (
    page === 'app-detail' &&
    selectedApp &&
    (selectedApp.kind === 'mode-app' || selectedApp.kind === 'standalone-agent-app')
  ) {
    return (
      <ModeAppDetailView
        app={selectedApp}
        onBack={openHome}
        onOpenAgent={(agentId) => openAgentDetail(agentId, selectedApp.id)}
      />
    );
  }

  return <AppsHomeView appsData={appsData} />;
};

export default AppsScene;
