/**
 * AppsScene 鈥?unified application hub.
 *
 * Layout (centered, max-width 860px):
 *   hero (title + subtitle)
 *   search bar
 *   carousel  鈫?global featured banner, always visible on home
 *   [Agent App] [Live App] [Bridge App]  鈫?tab pills below carousel
 *   list  鈫?2脳4 grid per page with pagination (8 items max per page)
 *
 * Clicking a row:
 *   Mode Agent App 鈫?app overview (`ModeAppDetailView`) 鈫?per-agent Agent detail (tools / skills).
 *   Standalone Agent App 鈫?same overview first, then agent detail.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Cable,
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
import {
  ActionListRow,
  Badge,
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  IconButton,
  ModeSwitch,
  NavigationList,
  NavigationListItem,
  Pagination,
  Search,
  SelectableRow,
  Skeleton,
  StatusDot,
  StatusPill,
} from '@/design-system';
import { GalleryDetailModal } from '@/app/components';
import { open } from '@tauri-apps/plugin-dialog';
import { liveAppAPI } from '@/infrastructure/api/service-api/LiveAppAPI';
import type { LiveAppMeta } from '@/infrastructure/api/service-api/LiveAppAPI';
import { openWorkspaceHome, openWorkspaceScene } from '@/app/navigation/workspaceNavigation';
import { useWorkspaceSurfaceStore } from '@/app/navigation/workspaceSurfaceStore';
import type { WorkspaceSceneId } from '@/app/navigation/workspaceSceneTypes';
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
const VIEW_KEYS = ['discover', 'manage'] as const;
/** Main list: 2 columns 脳 4 rows per page. */
const LIST_PAGE_SIZE = 8;
type AppsData = ReturnType<typeof useAppsData>;
type AppsView = typeof VIEW_KEYS[number];

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
        <Skeleton className="apps-list-row__sk-icon" variant="block" />
        <div className="apps-list-row__sk-body">
          <div className="apps-list-row__sk-head">
            <Skeleton className="apps-list-row__sk-line apps-list-row__sk-line--name" variant="text" />
            <Skeleton className="apps-list-row__sk-pill" variant="block" />
          </div>
          <Skeleton className="apps-list-row__sk-line apps-list-row__sk-line--desc" variant="text" />
          <Skeleton className="apps-list-row__sk-line apps-list-row__sk-line--meta" variant="text" />
        </div>
        {showActions ? (
          <div className="apps-list-row__sk-actions">
            <Skeleton className="apps-list-row__sk-action" variant="block" />
            <Skeleton className="apps-list-row__sk-action" variant="block" />
          </div>
        ) : (
          <Skeleton className="apps-list-row__sk-chevron" variant="circle" />
        )}
      </div>
    ))}
  </div>
);

const AppsListPagination: React.FC<{
  pageIndex: number;
  totalPages: number;
  onChange: (pageIndex: number) => void;
}> = ({ pageIndex, totalPages, onChange }) => {
  const { t } = useTranslation('scenes/apps');
  if (totalPages <= 1) return null;
  return (
    <div className="apps-scene__list-pagination">
      <span className="apps-scene__list-page-indicator">
        {t('page.pagination.pageOf', { current: pageIndex + 1, total: totalPages })}
      </span>
      <Pagination
        compact
        label={t('page.pagination.ariaLabel')}
        page={pageIndex + 1}
        pageCount={totalPages}
        onChange={(nextPage) => onChange(nextPage - 1)}
      />
    </div>
  );
};

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// App Carousel  (global featured banner, always on home)
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

const AgentAppRow: React.FC<{
  app: AppCardModel;
  onNavigate: (app: AppCardModel) => void;
}> = ({ app, onNavigate }) => {
  const { t } = useTranslation('scenes/apps');
  const Icon = app.kind === 'mode-app' ? Cpu : Bot;
  const isMode = app.kind === 'mode-app';

  return (
    <SelectableRow
      className="apps-list-row"
      leading={<span className="apps-list-row__icon apps-list-row__icon--agent"><Icon size={18} /></span>}
      title={(
        <span className="apps-list-row__head">
          <span>{appName(app, t)}</span>
          <Badge variant={isMode ? 'accent' : 'purple'}>{t(app.badgeKey)}</Badge>
        </span>
      )}
      description={appDescription(app, t)}
      meta={(
        <span className="apps-list-row__meta">
          {isMode
            ? t('page.containsAgents', { count: app.includedAgents.length })
            : app.includedAgents[0]
              ? getStandaloneAppRowMeta(app.includedAgents[0], t)
              : ''}
        </span>
      )}
      onClick={() => onNavigate(app)}
    />
  );
};

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// Live App list row
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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
    <ActionListRow
      className={`apps-list-row apps-list-row--live${summary.isRunning ? ' is-running' : ''}${summary.hasAttention ? ' has-attention' : ''}`}
      onClick={() => onOpenDetails(app)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpenDetails(app)}
      leading={(
        <span className="apps-list-row__icon apps-list-row__icon--live">
          {renderLiveAppIcon(app.icon || 'live-app', 18)}
        </span>
      )}
      title={(
        <span className="apps-list-row__head">
          <span className="apps-list-row__name">{app.name}</span>
          {summary.isRunning && <StatusDot className="apps-list-row__run-dot" tone="success" />}
          <span className="apps-list-row__version">v{app.version}</span>
        </span>
      )}
      description={app.description}
      meta={<LiveAppRuntimeBadges summary={summary} t={t} className="apps-list-row__runtime" />}
      actions={(
        <div className="apps-list-row__actions" onClick={(e) => e.stopPropagation()}>
          <IconButton
            className="apps-list-row__action"
            variant="primary"
            size="xs"
            onClick={() => {
              if (summary.depsDirty) {
                void onInstallDeps(app.id);
                return;
              }
              void onOpen(app.id);
            }}
            aria-label={primaryTitle}
            tooltip={primaryTitle}
          >
            {summary.depsDirty ? <RefreshCw size={13} /> : <Play size={13} fill="currentColor" strokeWidth={0} />}
          </IconButton>
        {summary.isRunning ? (
          <IconButton className="apps-list-row__action" variant="success" size="xs"
            onClick={() => void onStop(app.id)} aria-label={t('liveApp.card.stop')} tooltip={t('liveApp.card.stop')}>
            <Square size={12} />
          </IconButton>
        ) : summary.workerRestartRequired ? (
          <IconButton className="apps-list-row__action" variant="success" size="xs"
            onClick={() => void onOpen(app.id)} aria-label={t('liveApp.actions.restartWorker')} tooltip={t('liveApp.actions.restartWorker')}>
            <Play size={12} fill="currentColor" strokeWidth={0} />
          </IconButton>
        ) : (
          <IconButton className="apps-list-row__action" variant="ghost" size="xs"
            onClick={() => void onSyncFromFs(app.id)} aria-label={t('liveApp.actions.syncFromFs')} tooltip={t('liveApp.actions.syncFromFs')}>
            <RefreshCw size={12} />
          </IconButton>
        )}
        {!summary.isRunning && !summary.workerRestartRequired ? (
          <IconButton className="apps-list-row__action" variant="danger" size="xs"
            onClick={() => onDelete(app.id)} aria-label={t('liveApp.card.delete')} tooltip={t('liveApp.card.delete')}>
            <Trash2 size={12} />
          </IconButton>
        ) : null}
        <IconButton className="apps-list-row__action" variant="ghost" size="xs"
          onClick={() => void onRecompile(app.id)} aria-label={t('liveApp.actions.recompile')} tooltip={t('liveApp.actions.recompile')}>
          <RefreshCw size={12} />
        </IconButton>
        </div>
      )}
    />
  );
};

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// Home view
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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
  const activeSurface = useWorkspaceSurfaceStore((s) => s.activeSurface);
  const activeSceneId = activeSurface.kind === 'scene' ? activeSurface.sceneId : null;

  const [liveSearch, setLiveSearch]           = useState('');
  const [selectedLiveApp, setSelectedLiveApp] = useState<LiveAppMeta | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<AppsView>('discover');
  const [intent, setIntent] = useState('');
  const [showIntentPlan, setShowIntentPlan] = useState(false);

  const runningIdSet = useMemo(() => new Set(runningWorkerIds), [runningWorkerIds]);
  const openedIdSet = useMemo(() => new Set(openedAppIds), [openedAppIds]);
  const openTabIds   = useMemo(() => new Set(activeSceneId ? [activeSceneId] : []), [activeSceneId]);

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

  const discoverSuggestions = useMemo(
    () => ['testDiagnosis', 'dataDashboard', 'codeReview', 'dailyReport'],
    [],
  );

  const recommendedAgentApps = useMemo(() => {
    const q = intent.trim().toLowerCase();
    if (!q) return appCards.slice(0, 3);
    const scored = appCards
      .map((app) => {
        const text = [
          app.id,
          appName(app, t),
          appDescription(app, t),
          ...app.includedAgents.map((agent) => `${agent.id} ${agent.name}`),
        ].join(' ').toLowerCase();
        const score = q.split(/\s+/).filter((part) => part && text.includes(part)).length;
        return { app, score };
      })
      .sort((a, b) => b.score - a.score);
    return scored.filter((item) => item.score > 0).map((item) => item.app).slice(0, 3);
  }, [appCards, intent, t]);

  const manageTabs = useMemo(() => ([
    {
      id: 'agent-app' as AppsTab,
      icon: <Bot size={15} />,
      count: appCards.length,
    },
    {
      id: 'live-app' as AppsTab,
      icon: <Sparkles size={15} />,
      count: liveApps.length,
    },
    {
      id: 'bridge-app' as AppsTab,
      icon: <Cable size={15} />,
      count: 0,
    },
  ]), [appCards.length, liveApps.length]);

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
    openWorkspaceScene(`live-app:${appId}` as WorkspaceSceneId);
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

  const handleGenerateIntentPlan = useCallback(() => {
    setShowIntentPlan(true);
  }, []);

  const handleUseSuggestion = useCallback((key: string) => {
    setIntent(t(`discover.suggestions.${key}`));
    setShowIntentPlan(true);
  }, [t]);

  const handleManageSearch = useCallback(() => {
    const query = intent.trim();
    if (query) {
      setSearchQuery(query);
      setLiveSearch(query);
    }
    setActiveView('manage');
  }, [intent, setSearchQuery]);

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
    const sceneId = `live-app:${appId}` as WorkspaceSceneId;
    try { await liveAppAPI.workerStop(appId); } catch (e) { log.warn('Stop failed', e); }
    finally {
      markStopped(appId);
      if (openTabIds.has(sceneId)) void openWorkspaceHome();
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
      const sceneId = `live-app:${appId}` as WorkspaceSceneId;
      if (openTabIds.has(sceneId)) void openWorkspaceHome();
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
        <div className={`apps-scene__scroll-inner apps-scene__scroll-inner--${activeView}`}>
        <div className="apps-scene__mode-bar">
          <ModeSwitch
            ariaLabel={t('view.label')}
            value={activeView}
            onChange={(view) => setActiveView(view as AppsView)}
            options={VIEW_KEYS.map((view) => ({
              value: view,
              label: t(`view.${view}`),
            }))}
          />
        </div>

        {activeView === 'discover' && (
          <section className="apps-discover">
            <div className="apps-discover__center">
              <header className="apps-discover__hero">
                <h1>{t('discover.title')}</h1>
                <p>{t('discover.subtitle')}</p>
              </header>

              <div className="apps-discover__composer">
                <div className="apps-discover__intent-shell">
                  <span className="apps-discover__intent-orbit" aria-hidden="true" />
                  <Search
                    className="apps-discover__intent-input"
                    value={intent}
                    onChange={(value) => {
                      setIntent(value);
                      setShowIntentPlan(false);
                    }}
                    onSearch={handleGenerateIntentPlan}
                    onClear={() => {
                      setIntent('');
                      setShowIntentPlan(false);
                    }}
                    placeholder={t('discover.placeholder')}
                    size="large"
                    clearable={false}
                    showPrefixIcon={false}
                    maxLength={240}
                    suffixContent={(
                      <div className="apps-discover__intent-actions">
                        <IconButton
                          type="button"
                          variant="ghost"
                          size="small"
                          shape="circle"
                          onClick={handleGenerateIntentPlan}
                          disabled={!intent.trim()}
                          aria-label={t('discover.actions.generatePlan')}
                          tooltip={t('discover.actions.generatePlan')}
                        >
                          <Sparkles size={13} />
                        </IconButton>
                        <IconButton
                          type="button"
                          variant="brand"
                          size="small"
                          shape="circle"
                          onClick={handleManageSearch}
                          disabled={!intent.trim()}
                          aria-label={t('discover.actions.findExisting')}
                          tooltip={t('discover.actions.findExisting')}
                        >
                          <ArrowRight size={13} />
                        </IconButton>
                      </div>
                    )}
                  />
                </div>
                <div className="apps-discover__assist-row">
                  <div className="apps-discover__suggestions" aria-label={t('discover.suggestionsLabel')}>
                    {discoverSuggestions.map((key) => (
                      <Button
                        key={key}
                        type="button"
                        variant="ghost"
                        size="small"
                        onClick={() => handleUseSuggestion(key)}
                      >
                        {t(`discover.suggestions.${key}`)}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

            </div>

            <div className="apps-discover__lower">
              {showIntentPlan ? (
                <div className="apps-discover__plan">
                  <div className="apps-discover__plan-main">
                    <Badge variant="accent">{t('discover.plan.badge')}</Badge>
                    <h2>{t('discover.plan.title')}</h2>
                    <p>{t('discover.plan.description')}</p>
                    <div className="apps-discover__plan-bullets">
                      <span>{t('discover.plan.capability')}</span>
                      <span>{t('discover.plan.permissions')}</span>
                      <span>{t('discover.plan.boundary')}</span>
                    </div>
                  </div>
                  <div className="apps-discover__plan-actions">
                    <Button variant="secondary" onClick={handleOpenStudio}>
                      <PencilRuler size={14} />
                      <span>{t('discover.actions.createLiveApp')}</span>
                    </Button>
                    <Button onClick={handleOpenAgentAppStudio}>
                      <Bot size={14} />
                      <span>{t('discover.actions.createAgentApp')}</span>
                    </Button>
                  </div>
                </div>
              ) : null}

              <section className="apps-discover__recommendations" aria-label={t('discover.recommendations.title')}>
                <div className="apps-discover__section-head">
                  <h2>{t('discover.recommendations.title')}</h2>
                  <Button variant="ghost" size="small" onClick={() => setActiveView('manage')}>
                    {t('discover.recommendations.manageAll')}
                  </Button>
                </div>
                {agentLoading ? (
                  <AppsListSkeleton rowCount={3} />
                ) : recommendedAgentApps.length > 0 ? (
                  <div className="apps-discover__recommended-list">
                    {recommendedAgentApps.map((app) => (
                      <Card key={app.id} variant="subtle" padding="none" radius="small" interactive>
                        <CardBody className="apps-discover__recommendation-card">
                          <button type="button" onClick={() => handleNavigateAgentApp(app)}>
                            <span className="apps-discover__recommendation-icon">
                              {app.kind === 'mode-app' ? <Cpu size={16} /> : <Bot size={16} />}
                            </span>
                            <span className="apps-discover__recommendation-main">
                              <span className="apps-discover__recommendation-title">{appName(app, t)}</span>
                              <span className="apps-discover__recommendation-desc">{appDescription(app, t)}</span>
                            </span>
                          </button>
                        </CardBody>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="apps-scene__empty">
                    <Sparkles size={28} strokeWidth={1.5} />
                    <p>{t('discover.recommendations.empty')}</p>
                  </div>
                )}
              </section>
            </div>
          </section>
        )}

        {activeView === 'manage' && (
          <div className="apps-manage">
            <aside className="apps-manage__sidebar">
              <div className="apps-manage__sidebar-header">
                <h2>{t('manage.title')}</h2>
                <p>{t('manage.sidebarSubtitle')}</p>
              </div>
              <NavigationList className="apps-manage__nav" variant="plain" aria-label={t('tabs.label')}>
                {manageTabs.map((tab) => (
                  <NavigationListItem
                    key={tab.id}
                    active={activeTab === tab.id}
                    icon={tab.icon}
                    meta={(
                      <StatusPill tone="neutral" size="small" leadingDot={false}>
                        {tab.count}
                      </StatusPill>
                    )}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {t(`tabs.${tab.id}`)}
                  </NavigationListItem>
                ))}
              </NavigationList>
              <div className="apps-manage__sidebar-footer">
                <p>{t(`manage.hints.${activeTab}`)}</p>
              </div>
            </aside>

            <main className="apps-manage__main">
              <header className="apps-manage__toolbar">
                <div className="apps-manage__toolbar-copy">
                  <h1>{t(`tabs.${activeTab}`)}</h1>
                  <p>{t('manage.subtitle')}</p>
                </div>
                <div className="apps-manage__toolbar-actions">
                  <Search
                    className="apps-manage__search"
                    value={effectiveSearch}
                    onChange={onChangeSearch}
                    onClear={() => onChangeSearch('')}
                    placeholder={t(`tabs.searchPlaceholder.${activeTab}`)}
                    size="small"
                    clearable
                    prefixIcon={<SearchIcon size={13} />}
                  />
                  {activeTab === 'agent-app' && (
                    <Button size="small" onClick={handleOpenAgentAppStudio} title={t('page.newAgentApp')}>
                      <Plus size={14} />
                      <span>{t('page.newAgentApp')}</span>
                    </Button>
                  )}
                  {activeTab === 'live-app' && (
                    <div className="apps-scene__list-actions">
                      <Button
                        size="small"
                        variant="secondary"
                        onClick={handleOpenStudio}
                        title={t('liveApp.openStudio')}
                      >
                        <PencilRuler size={14} />
                        <span>{t('liveApp.openStudio')}</span>
                      </Button>
                      <Button
                        size="small"
                        onClick={handleAddFromFolder}
                        disabled={liveLoading}
                        title={t('liveApp.importFromFolder')}
                      >
                        <FolderPlus size={14} />
                        <span>{t('liveApp.importFromFolder')}</span>
                      </Button>
                      <Button
                        size="small"
                        variant="secondary"
                        onClick={refetchLive}
                        disabled={liveLoading}
                        title={t('liveApp.actions.refreshCatalog')}
                      >
                        <RefreshCw size={14} />
                        <span>{t('liveApp.actions.refreshCatalog')}</span>
                      </Button>
                    </div>
                  )}
                  {activeTab === 'bridge-app' && (
                    <Button size="small" disabled title={t('bridgeApp.comingSoon')}>
                      <Plus size={14} />
                      <span>{t('page.newBridgeApp')}</span>
                    </Button>
                  )}
                </div>
              </header>

              <section className="apps-manage__content">
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
                        onChange={setListPage}
                      />
                    </div>
                  )
                )}

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
                        onChange={setListPage}
                      />
                    </div>
                  )
                )}

                {activeTab === 'bridge-app' && (
                  <div className="apps-scene__bridge-empty">
                    <Cable size={40} strokeWidth={1.2} />
                    <h3>{t('bridgeApp.title')}</h3>
                    <p>{t('bridgeApp.comingSoon')}</p>
                  </div>
                )}
              </section>
            </main>
          </div>
        )}

        </div>
      </div>

      {/* 鈹€鈹€ Live App detail modal 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */}
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
              <Badge key={tag} variant="neutral" className="apps-scene__detail-tag">
                <Tag size={11} />
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}
      </GalleryDetailModal>

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setPendingDeleteId(null);
          }
        }}
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

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// Root
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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


