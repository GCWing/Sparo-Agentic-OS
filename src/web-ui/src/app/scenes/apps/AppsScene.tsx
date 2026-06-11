/**
 * AppsScene — unified application hub.
 *
 * Layout (centered, max-width 860px):
 *   hero (title + subtitle)
 *   search bar
 *   carousel → global featured banner, always visible on home
 *   [Agent App] [Live App] [Bridge App] → tab pills below carousel
 *   list → 2×4 grid per page with pagination (8 items max per page)
 *
 * Clicking a row:
 *   Multi-Agent App → app overview (`AgentAppDetailView`) → per-agent Agent detail (tools / skills).
 *   Standalone Agent App → same overview first, then agent detail.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
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
  Badge,
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  IconButton,
  ItemCard,
  ItemCardActions,
  ItemCardMeta,
  ItemCardMetaItem,
  ItemCardTitle,
  ItemCardTop,
  ModeSwitch,
  NavigationList,
  NavigationListItem,
  Pagination,
  Search,
  Skeleton,
  StatusDot,
  StatusPill,
  SparoAgentIcon,
} from '@/design-system';
import { GalleryDetailModal } from '@/app/components';
import { open } from '@tauri-apps/plugin-dialog';
import { liveAppAPI } from '@/infrastructure/api/service-api/LiveAppAPI';
import type { LiveAppMeta } from '@/infrastructure/api/service-api/LiveAppAPI';
import {
  bridgeAppAPI,
  type BridgeAppAction,
  type BridgeAppCapability,
  type BridgeAppPackage,
  type BridgeAppRunResult,
} from '@/infrastructure/api/service-api/BridgeAppAPI';
import { openWorkspaceHome, openWorkspaceScene } from '@/app/navigation/workspaceNavigation';
import { useWorkspaceSurfaceStore } from '@/app/navigation/workspaceSurfaceStore';
import type { WorkspaceSceneId } from '@/app/navigation/workspaceSceneTypes';
import { useLastUsedWorkspace, useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import { createLogger } from '@/shared/utils/logger';
import { useGallerySceneAutoRefresh } from '@/app/hooks/useGallerySceneAutoRefresh';
import { notificationService } from '@/shared/notification-system';
import { launchWorkForChoice } from '@/app/components/WorkDock/NewWorkDialog';
import { getAppCategoryLabel, getStandaloneAppRowMeta } from './appsUtils';
import { useAppsStore, type AppsHomeView, type AppsTab } from './appsStore';
import { useAppsData } from './hooks/useAppsData';
import type { AppCardModel } from './hooks/useAppsData';
import { useLiveAppStore } from './live-app/liveAppStore';
import LiveAppRuntimeBadges from './live-app/components/LiveAppRuntimeBadges';
import {
  buildLiveAppRuntimeSummary,
  summarizeLiveAppPermissions,
} from './live-app/liveAppRuntimeModel';
import { renderLiveAppIcon } from './live-app/liveAppIconHelpers';
import { resolveLiveAppMeta } from './live-app/liveAppI18n';
import { AppDetailScene } from './app-detail/AppDetailScene';
import './AppsScene.scss';

const log = createLogger('AppsScene');
const VIEW_KEYS = ['discover', 'manage'] as const;
/** Manage list: up to 5 rows per page, reduced when the content area is short. */
const MANAGE_MAX_ROWS = 5;
const MANAGE_CARD_MIN_HEIGHT = 136;
const MANAGE_GRID_ROW_GAP = 14;
const MANAGE_CONTENT_VERTICAL_PADDING = 52;
const MANAGE_PAGINATION_RESERVED_HEIGHT = 44;
type AppsData = ReturnType<typeof useAppsData>;
type DiscoverRecommendationItem =
  | { type: 'agent-app'; app: AppCardModel }
  | { type: 'live-app'; app: LiveAppMeta }
  | { type: 'bridge-app'; app: BridgeAppPackage };
type ManageAppItem =
  | { type: 'agent-app'; app: AppCardModel }
  | { type: 'live-app'; app: LiveAppMeta }
  | { type: 'bridge-app'; app: BridgeAppPackage };

function appItemId(item: DiscoverRecommendationItem | ManageAppItem): string {
  return item.type === 'bridge-app' ? item.app.manifest.id : item.app.id;
}

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

function getManageColumnCount(viewportWidth: number): number {
  if (viewportWidth <= 860) return 1;
  if (viewportWidth <= 1180) return 2;
  return 3;
}

function getManageRowCount(contentHeight: number): number {
  if (contentHeight <= 0) return MANAGE_MAX_ROWS;
  const availableHeight = Math.max(
    0,
    contentHeight - MANAGE_CONTENT_VERTICAL_PADDING - MANAGE_PAGINATION_RESERVED_HEIGHT,
  );
  const rows = Math.floor((availableHeight + MANAGE_GRID_ROW_GAP) / (MANAGE_CARD_MIN_HEIGHT + MANAGE_GRID_ROW_GAP));
  return Math.max(1, Math.min(MANAGE_MAX_ROWS, rows));
}

const AppsListSkeleton: React.FC<{
  rowCount?: number;
  showActions?: boolean;
}> = ({ rowCount = MANAGE_MAX_ROWS, showActions = false }) => (
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

const AppsDiscoverRecommendationsSkeleton: React.FC<{
  cardCount?: number;
}> = ({ cardCount = 3 }) => (
  <div className="apps-discover__recommended-list apps-discover__recommended-list--skeleton" aria-busy="true">
    {Array.from({ length: cardCount }).map((_, index) => (
      <Card key={`discover-recommendation-skeleton-${index}`} variant="subtle" padding="none" radius="small">
        <CardBody className="apps-discover__recommendation-card apps-discover__recommendation-card--skeleton">
          <div className="apps-discover__recommendation-skeleton">
            <Skeleton className="apps-discover__recommendation-skeleton-icon" variant="block" />
            <div className="apps-discover__recommendation-skeleton-main">
              <Skeleton className="apps-discover__recommendation-skeleton-title" variant="text" />
              <Skeleton className="apps-discover__recommendation-skeleton-desc" variant="text" />
              <Skeleton className="apps-discover__recommendation-skeleton-desc apps-discover__recommendation-skeleton-desc--short" variant="text" />
            </div>
          </div>
        </CardBody>
      </Card>
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

// -----------------------------------------------------------------------------
// App Carousel  (global featured banner, always on home)
// -----------------------------------------------------------------------------

const AgentAppRow: React.FC<{
  app: AppCardModel;
  onNavigate: (app: AppCardModel) => void;
  getModelDisplayName: (modelRef?: string | null) => string;
}> = ({ app, onNavigate, getModelDisplayName }) => {
  const { t } = useTranslation('scenes/apps');
  const Icon = app.kind === 'multi-agent-app' ? Cpu : SparoAgentIcon;
  const isMultiAgent = app.kind === 'multi-agent-app';

  return (
    <ItemCard
      className="apps-list-card apps-list-card--agent"
      status="idle"
      onActivate={() => onNavigate(app)}
      aria-label={appName(app, t)}
    >
      <ItemCardTop className="apps-list-card__top">
        <span className="apps-list-card__icon apps-list-card__icon--agent"><Icon size={18} /></span>
        <ItemCardTitle className="apps-list-card__title">
          <span>{appName(app, t)}</span>
        </ItemCardTitle>
        <Badge variant={isMultiAgent ? 'accent' : 'purple'} className="apps-list-card__badge">
          {t(app.badgeKey)}
        </Badge>
      </ItemCardTop>
      <div className="apps-list-card__description">{appDescription(app, t)}</div>
      <ItemCardMeta className="apps-list-card__meta">
        <ItemCardMetaItem className="apps-list-card__meta-item">
            {isMultiAgent
              ? t('page.containsAgents', { count: app.includedAgents.length })
              : app.includedAgents[0]
              ? getStandaloneAppRowMeta(app.includedAgents[0], t, getModelDisplayName)
              : ''}
        </ItemCardMetaItem>
      </ItemCardMeta>
    </ItemCard>
  );
};

// -----------------------------------------------------------------------------
// Live App list row
// -----------------------------------------------------------------------------

const LiveAppRow: React.FC<{
  app: LiveAppMeta;
  isOpen: boolean;
  isRunning: boolean;
  runtimeAvailable: boolean;
  onOpenDetails: (app: LiveAppMeta) => void;
  onOpen: (id: string) => void;
  onInstallDeps: (id: string) => Promise<void>;
  onRecompile: (id: string) => Promise<void>;
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
  onStop,
  onDelete,
}) => {
  const { t, i18n } = useTranslation('scenes/apps');
  const displayMeta = resolveLiveAppMeta(app, i18n.resolvedLanguage ?? i18n.language);
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
    <ItemCard
      className={`apps-list-card apps-list-card--live${summary.hasAttention ? ' has-attention' : ''}`}
      status={summary.isRunning ? 'running' : summary.hasAttention ? 'active' : 'idle'}
      onActivate={() => onOpenDetails(app)}
      aria-label={displayMeta.name}
    >
      <ItemCardTop className="apps-list-card__top">
        <span className="apps-list-card__icon apps-list-card__icon--live">
          {renderLiveAppIcon(app.icon || 'live-app', 18)}
        </span>
        <ItemCardTitle className="apps-list-card__title">
          <span>{displayMeta.name}</span>
        </ItemCardTitle>
        {summary.isRunning && <StatusDot className="apps-list-card__run-dot" tone="success" />}
        <span className="apps-list-card__version">v{app.version}</span>
      </ItemCardTop>
      <div className="apps-list-card__description">{displayMeta.description}</div>
      <ItemCardMeta className="apps-list-card__meta">
        <LiveAppRuntimeBadges summary={summary} t={t} className="apps-list-card__runtime" />
      </ItemCardMeta>
      <ItemCardActions className="apps-list-card__actions" onClick={(e) => e.stopPropagation()}>
          <IconButton
            className="apps-list-card__action"
            variant="ghost"
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
          <IconButton className="apps-list-card__action" variant="ghost" size="xs"
            onClick={() => void onStop(app.id)} aria-label={t('liveApp.card.stop')} tooltip={t('liveApp.card.stop')}>
            <Square size={12} />
          </IconButton>
        ) : null}
        <IconButton className="apps-list-card__action" variant="ghost" size="xs"
          onClick={() => void onRecompile(app.id)} aria-label={t('liveApp.actions.recompile')} tooltip={t('liveApp.actions.recompile')}>
          <RefreshCw size={12} />
        </IconButton>
        {!summary.isRunning ? (
          <IconButton className="apps-list-card__action" variant="ghost" size="xs"
            onClick={() => onDelete(app.id)} aria-label={t('liveApp.card.delete')} tooltip={t('liveApp.card.delete')}>
            <Trash2 size={12} />
          </IconButton>
        ) : null}
      </ItemCardActions>
    </ItemCard>
  );
};

const BridgeAppRow: React.FC<{
  app: BridgeAppPackage;
  isSelected: boolean;
  onSelect: (app: BridgeAppPackage) => void;
}> = ({ app, isSelected, onSelect }) => {
  const { t } = useTranslation('scenes/apps');
  const capabilityCount = app.manifest.capabilities?.length ?? 0;

  return (
    <ItemCard
      className={`apps-list-card apps-list-card--bridge${isSelected ? ' is-selected' : ''}`}
      status={isSelected ? 'active' : 'idle'}
      onActivate={() => onSelect(app)}
      aria-label={app.manifest.name}
    >
      <ItemCardTop className="apps-list-card__top">
        <span className="apps-list-card__icon apps-list-card__icon--bridge"><Cable size={18} /></span>
        <ItemCardTitle className="apps-list-card__title">
          <span>{app.manifest.name}</span>
        </ItemCardTitle>
        <Badge variant="info" className="apps-list-card__badge">
          {t(`bridgeApp.kind.${app.manifest.kind}`, { defaultValue: app.manifest.kind })}
        </Badge>
      </ItemCardTop>
      <div className="apps-list-card__description">{app.manifest.description}</div>
      <ItemCardMeta className="apps-list-card__meta">
        <ItemCardMetaItem className="apps-list-card__meta-item">
          {t('bridgeApp.capabilityCount', { count: capabilityCount })}
        </ItemCardMetaItem>
      </ItemCardMeta>
    </ItemCard>
  );
};

const BridgeAppRunner: React.FC<{
  app: BridgeAppPackage | null;
  workspacePath?: string | null;
  onRun: (app: BridgeAppPackage, action: BridgeAppAction, input: Record<string, unknown>, capability?: BridgeAppCapability) => Promise<void>;
  running: boolean;
  result: BridgeAppRunResult | null;
}> = ({ app, workspacePath, onRun, running, result }) => {
  const { t } = useTranslation('scenes/apps');
  const [actionName, setActionName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('composer-2');
  const [apiKey, setApiKey] = useState('');
  const [mode, setMode] = useState<'local' | 'cloud'>('local');
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const capabilities = useMemo(() => app?.manifest.capabilities ?? [], [app?.manifest.capabilities]);
  const selectedCapability = capabilities[0] ?? undefined;
  const actions = useMemo(() => app?.manifest.actions ?? [], [app?.manifest.actions]);
  const selectedAction = actions.find((action) => action.name === actionName) ?? actions[0] ?? null;

  useEffect(() => {
    setActionName(actions[0]?.name ?? '');
  }, [app?.manifest.id, actions]);

  if (!app) {
    return (
      <div className="apps-bridge-runner apps-bridge-runner--empty">
        <Cable size={28} strokeWidth={1.4} />
        <p>{t('bridgeApp.selectHint')}</p>
      </div>
    );
  }

  const run = () => {
    if (!selectedAction) return;
    const input: Record<string, unknown> = {
      model,
      autoInstallDependencies: true,
    };
    if (apiKey.trim()) input.apiKey = apiKey.trim();
    if (selectedAction.name === 'start') {
      input.mode = mode;
      input.prompt = prompt.trim();
      input.agentName = mode === 'cloud' ? 'Sparo Cursor Cloud Agent' : 'Sparo Cursor Local Agent';
    }
    if (selectedAction.name === 'start' && mode === 'cloud') {
      input.repositoryUrl = repositoryUrl.trim();
      input.autoCreatePR = true;
    }
    if (selectedAction.name === 'health') {
      input.validateApiKey = Boolean(apiKey.trim());
    }
    void onRun(app, selectedAction, input, selectedCapability);
  };

  const requiresPrompt = selectedAction?.name === 'start';
  const canRun = Boolean(selectedAction) && !running && (!requiresPrompt || prompt.trim().length > 0);

  return (
    <aside className="apps-bridge-runner">
      <div className="apps-bridge-runner__header">
        <span className="apps-list-card__icon apps-list-card__icon--bridge"><Cable size={18} /></span>
        <div>
          <h3>{app.manifest.name}</h3>
          <p>{app.manifest.description}</p>
        </div>
      </div>

      <div className="apps-bridge-runner__form">
        <label>
          <span>{t('bridgeApp.fields.action')}</span>
          <select value={selectedAction?.name ?? ''} onChange={(event) => setActionName(event.target.value)}>
            {actions.map((action) => (
              <option key={action.name} value={action.name}>{action.description}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('bridgeApp.fields.apiKey')}</span>
          <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} type="password" placeholder="CURSOR_API_KEY" />
        </label>
        <label>
          <span>{t('bridgeApp.fields.model')}</span>
          <input value={model} onChange={(event) => setModel(event.target.value)} />
        </label>
        {requiresPrompt ? (
          <label>
            <span>{t('bridgeApp.fields.prompt')}</span>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={5} />
          </label>
        ) : null}
        {selectedAction?.name === 'start' && mode === 'cloud' ? (
          <label>
            <span>{t('bridgeApp.fields.repository')}</span>
            <input value={repositoryUrl} onChange={(event) => setRepositoryUrl(event.target.value)} placeholder="https://github.com/owner/repo" />
          </label>
        ) : null}
        <div className="apps-bridge-runner__meta">
          <Badge variant={workspacePath ? 'info' : 'neutral'}>
            {workspacePath || t('bridgeApp.noWorkspace')}
          </Badge>
          <Badge variant="neutral">{mode}</Badge>
        </div>
        {requiresPrompt ? (
          <ModeSwitch
            ariaLabel={t('bridgeApp.fields.mode')}
            value={mode}
            onChange={(value) => setMode(value as 'local' | 'cloud')}
            options={[
              { value: 'local', label: t('bridgeApp.mode.local') },
              { value: 'cloud', label: t('bridgeApp.mode.cloud') },
            ]}
          />
        ) : null}
        <Button size="small" onClick={run} disabled={!canRun}>
          <Play size={14} />
          <span>{running ? t('bridgeApp.running') : t('bridgeApp.run')}</span>
        </Button>
      </div>

      {result ? (
        <div className="apps-bridge-runner__result">
          <div className="apps-bridge-runner__result-head">
            <StatusPill tone={result.status === 'completed' ? 'success' : 'error'} size="small">
              {result.status}
            </StatusPill>
            <span>{result.action}</span>
          </div>
          <pre>{JSON.stringify(result.output, null, 2)}</pre>
          {result.stderr ? <pre className="apps-bridge-runner__stderr">{result.stderr}</pre> : null}
        </div>
      ) : null}
    </aside>
  );
};

const DiscoverRecommendationCard: React.FC<{
  item: DiscoverRecommendationItem;
  isOpen: boolean;
  isRunning: boolean;
  runtimeAvailable: boolean;
  onNavigateAgentApp: (app: AppCardModel) => void;
  onOpenLiveApp: (id: string) => void;
  onSelectBridgeApp: (app: BridgeAppPackage) => void;
  getModelDisplayName: (modelRef?: string | null) => string;
}> = ({
  item,
  isOpen,
  isRunning,
  runtimeAvailable,
  onNavigateAgentApp,
  onOpenLiveApp,
  onSelectBridgeApp,
  getModelDisplayName,
}) => {
  const { t, i18n } = useTranslation('scenes/apps');

  if (item.type === 'agent-app') {
    const app = item.app;
    const Icon = app.kind === 'multi-agent-app' ? Cpu : SparoAgentIcon;
    const isMultiAgent = app.kind === 'multi-agent-app';

    return (
      <ItemCard
        className="apps-list-card apps-list-card--agent"
        status="idle"
        onActivate={() => onNavigateAgentApp(app)}
        aria-label={appName(app, t)}
      >
        <ItemCardTop className="apps-list-card__top">
          <span className="apps-list-card__icon apps-list-card__icon--agent"><Icon size={18} /></span>
          <ItemCardTitle className="apps-list-card__title">
            <span>{appName(app, t)}</span>
          </ItemCardTitle>
          <Badge variant={isMultiAgent ? 'accent' : 'purple'} className="apps-list-card__badge">
            {t(app.badgeKey)}
          </Badge>
        </ItemCardTop>
        <div className="apps-list-card__description">{appDescription(app, t)}</div>
        <ItemCardMeta className="apps-list-card__meta">
          <ItemCardMetaItem className="apps-list-card__meta-item">
            {isMultiAgent
              ? t('page.containsAgents', { count: app.includedAgents.length })
              : app.includedAgents[0]
                ? getStandaloneAppRowMeta(app.includedAgents[0], t, getModelDisplayName)
                : ''}
          </ItemCardMetaItem>
        </ItemCardMeta>
      </ItemCard>
    );
  }

  if (item.type === 'bridge-app') {
    return (
      <ItemCard
        className="apps-list-card apps-list-card--bridge"
        status="idle"
        onActivate={() => onSelectBridgeApp(item.app)}
        aria-label={item.app.manifest.name}
      >
        <ItemCardTop className="apps-list-card__top">
          <span className="apps-list-card__icon apps-list-card__icon--bridge"><Cable size={18} /></span>
          <ItemCardTitle className="apps-list-card__title">
            <span>{item.app.manifest.name}</span>
          </ItemCardTitle>
          <Badge variant="info" className="apps-list-card__badge">
            {t('tabs.bridge-app')}
          </Badge>
        </ItemCardTop>
        <div className="apps-list-card__description">{item.app.manifest.description}</div>
        <ItemCardMeta className="apps-list-card__meta">
          <ItemCardMetaItem className="apps-list-card__meta-item">
            {t('bridgeApp.actionCount', { count: item.app.manifest.actions?.length ?? 0 })}
          </ItemCardMetaItem>
        </ItemCardMeta>
      </ItemCard>
    );
  }

  const app = item.app;
  const displayMeta = resolveLiveAppMeta(app, i18n.resolvedLanguage ?? i18n.language);
  const summary = buildLiveAppRuntimeSummary(app, {
    isOpen,
    isRunning,
    runtimeStatus: { available: runtimeAvailable },
  });

  return (
    <ItemCard
      className={`apps-list-card apps-list-card--live${summary.hasAttention ? ' has-attention' : ''}`}
      status={summary.isRunning ? 'running' : summary.hasAttention ? 'active' : 'idle'}
      onActivate={() => onOpenLiveApp(app.id)}
      aria-label={displayMeta.name}
    >
      <ItemCardTop className="apps-list-card__top">
        <span className="apps-list-card__icon apps-list-card__icon--live">
          {renderLiveAppIcon(app.icon || 'live-app', 18)}
        </span>
        <ItemCardTitle className="apps-list-card__title">
          <span>{displayMeta.name}</span>
        </ItemCardTitle>
        {summary.isRunning && <StatusDot className="apps-list-card__run-dot" tone="success" />}
        <span className="apps-list-card__version">v{app.version}</span>
      </ItemCardTop>
      <div className="apps-list-card__description">{displayMeta.description}</div>
      <ItemCardMeta className="apps-list-card__meta">
        <LiveAppRuntimeBadges summary={summary} t={t} className="apps-list-card__runtime" />
      </ItemCardMeta>
    </ItemCard>
  );
};

// -----------------------------------------------------------------------------
// Home view
// -----------------------------------------------------------------------------

const AppsHomeView: React.FC<{
  appsData: AppsData;
}> = ({ appsData }) => {
  const { t, i18n } = useTranslation('scenes/apps');
  const currentLocale = i18n.resolvedLanguage ?? i18n.language;
  const {
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    homeView,
    setHomeView,
    homeListPage,
    setHomeListPage,
    openAppDetail,
  } = useAppsStore();

  const { appCards, loading: agentLoading, getModelDisplayName } = appsData;

  // Live App state
  const liveApps         = useLiveAppStore((s) => s.apps);
  const liveLoading      = useLiveAppStore((s) => s.loading);
  const runtimeStatus    = useLiveAppStore((s) => s.runtimeStatus);
  const openedAppIds     = useLiveAppStore((s) => s.openedAppIds);
  const recentAppIds     = useLiveAppStore((s) => s.recentAppIds);
  const runningAppIds    = useLiveAppStore((s) => s.runningAppIds);
  const setLiveApps      = useLiveAppStore((s) => s.setApps);
  const setLiveLoading   = useLiveAppStore((s) => s.setLoading);
  const setRecentAppIds  = useLiveAppStore((s) => s.setRecentAppIds);
  const setRuntimeStatus = useLiveAppStore((s) => s.setRuntimeStatus);
  const setRunningIds    = useLiveAppStore((s) => s.setRunningWorkerIds);
  const markStopped      = useLiveAppStore((s) => s.markWorkerStopped);
  const openLiveAppInStore = useLiveAppStore((s) => s.openApp);

  const { workspacePath } = useLastUsedWorkspace();
  const { rememberWorkspace } = useWorkspaceContext();
  const activeSurface = useWorkspaceSurfaceStore((s) => s.activeSurface);
  const activeSceneId = activeSurface.kind === 'scene' ? activeSurface.sceneId : null;

  const [liveSearch, setLiveSearch]           = useState('');
  const [selectedLiveApp, setSelectedLiveApp] = useState<LiveAppMeta | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [bridgeApps, setBridgeApps] = useState<BridgeAppPackage[]>([]);
  const [bridgeLoading, setBridgeLoading] = useState(false);
  const [selectedBridgeAppId, setSelectedBridgeAppId] = useState<string | null>(null);
  const [bridgeRunning, setBridgeRunning] = useState(false);
  const [bridgeRunResult, setBridgeRunResult] = useState<BridgeAppRunResult | null>(null);
  const [intent, setIntent] = useState('');
  const manageContentRef = useRef<HTMLElement | null>(null);
  const [manageRows, setManageRows] = useState(MANAGE_MAX_ROWS);
  const [manageColumns, setManageColumns] = useState(3);
  const managePageSize = manageRows * manageColumns;

  useEffect(() => {
    if (homeView !== 'manage') return;
    const element = manageContentRef.current;
    if (!element) return;

    const updateManagePageShape = () => {
      setManageRows(getManageRowCount(element.clientHeight));
      setManageColumns(getManageColumnCount(window.innerWidth));
    };

    updateManagePageShape();
    window.addEventListener('resize', updateManagePageShape);

    if (typeof ResizeObserver === 'undefined') {
      return () => {
        window.removeEventListener('resize', updateManagePageShape);
      };
    }

    const observer = new ResizeObserver(updateManagePageShape);
    observer.observe(element);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateManagePageShape);
    };
  }, [homeView]);

  const runningIdSet = useMemo(() => new Set(runningAppIds), [runningAppIds]);
  const openedIdSet = useMemo(() => new Set(openedAppIds), [openedAppIds]);
  const openTabIds   = useMemo(() => new Set(activeSceneId ? [activeSceneId] : []), [activeSceneId]);

  const filteredLiveApps = useMemo(() => {
    const q = (activeTab === 'all' ? searchQuery : liveSearch).toLowerCase();
    return liveApps.filter((app) => {
      const displayMeta = resolveLiveAppMeta(app, currentLocale);
      return (
        !q ||
        displayMeta.name.toLowerCase().includes(q) ||
        displayMeta.description.toLowerCase().includes(q) ||
        displayMeta.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }, [activeTab, currentLocale, liveApps, liveSearch, searchQuery]);

  const filteredBridgeApps = useMemo(() => {
    const q = searchQuery.toLowerCase();
    if (!q) return bridgeApps;
    return bridgeApps.filter((app) =>
      app.manifest.id.toLowerCase().includes(q) ||
      app.manifest.name.toLowerCase().includes(q) ||
      app.manifest.description.toLowerCase().includes(q) ||
      app.manifest.kind.toLowerCase().includes(q) ||
      app.manifest.actions?.some((action) =>
        action.name.toLowerCase().includes(q) ||
        action.description.toLowerCase().includes(q),
      ),
    );
  }, [bridgeApps, searchQuery]);

  // Filtered agent apps
  const filteredAgentApps = useMemo(() => {
    const q = searchQuery.toLowerCase();
    if (!q) return appCards;
    return appCards.filter((app) =>
      app.id.toLowerCase().includes(q) ||
      appName(app, t).toLowerCase().includes(q) ||
      appDescription(app, t).toLowerCase().includes(q) ||
      app.includedAgents.some((a) => a.name.toLowerCase().includes(q)),
    );
  }, [appCards, searchQuery, t]);

  const agentListTotalPages = Math.max(1, Math.ceil(filteredAgentApps.length / managePageSize));
  const liveListTotalPages = Math.max(1, Math.ceil(filteredLiveApps.length / managePageSize));
  const bridgeListTotalPages = Math.max(1, Math.ceil(filteredBridgeApps.length / managePageSize));
  const filteredAllApps = useMemo<ManageAppItem[]>(
    () => [
      ...filteredAgentApps.map((app) => ({ type: 'agent-app' as const, app })),
      ...filteredLiveApps.map((app) => ({ type: 'live-app' as const, app })),
      ...filteredBridgeApps.map((app) => ({ type: 'bridge-app' as const, app })),
    ],
    [filteredAgentApps, filteredBridgeApps, filteredLiveApps],
  );
  const allListTotalPages = Math.max(1, Math.ceil(filteredAllApps.length / managePageSize));

  useEffect(() => {
    if (activeTab !== 'all' && activeTab !== 'agent-app' && activeTab !== 'live-app' && activeTab !== 'bridge-app') return;
    const total =
      activeTab === 'all'
        ? allListTotalPages
        : activeTab === 'agent-app'
          ? agentListTotalPages
          : activeTab === 'live-app'
            ? liveListTotalPages
            : bridgeListTotalPages;
    setHomeListPage((p) => Math.min(p, total - 1));
  }, [activeTab, agentListTotalPages, allListTotalPages, bridgeListTotalPages, liveListTotalPages, setHomeListPage]);

  const pagedAllApps = useMemo(() => {
    const start = homeListPage * managePageSize;
    return filteredAllApps.slice(start, start + managePageSize);
  }, [filteredAllApps, homeListPage, managePageSize]);

  const pagedAgentApps = useMemo(() => {
    const start = homeListPage * managePageSize;
    return filteredAgentApps.slice(start, start + managePageSize);
  }, [filteredAgentApps, homeListPage, managePageSize]);

  const pagedLiveApps = useMemo(() => {
    const start = homeListPage * managePageSize;
    return filteredLiveApps.slice(start, start + managePageSize);
  }, [filteredLiveApps, homeListPage, managePageSize]);

  const pagedBridgeApps = useMemo(() => {
    const start = homeListPage * managePageSize;
    return filteredBridgeApps.slice(start, start + managePageSize);
  }, [filteredBridgeApps, homeListPage, managePageSize]);

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

  const discoverSearchResults = useMemo(() => {
    const q = intent.trim().toLowerCase();
    if (!q) {
      return recommendedAgentApps.map((app) => ({ type: 'agent-app' as const, app }));
    }

    const matches = (parts: string[]) => {
      const text = parts.join(' ').toLowerCase();
      return q.split(/\s+/).every((part) => !part || text.includes(part));
    };

    const agentResults = appCards
      .filter((app) => matches([
        app.id,
        appName(app, t),
        appDescription(app, t),
        ...app.includedAgents.map((agent) => `${agent.id} ${agent.name}`),
      ]))
      .map((app) => ({ type: 'agent-app' as const, app }));

    const liveResults = liveApps
      .filter((app) => {
        const displayMeta = resolveLiveAppMeta(app, currentLocale);
        return matches([
          app.id,
          displayMeta.name,
          displayMeta.description,
          ...displayMeta.tags,
        ]);
      })
      .map((app) => ({ type: 'live-app' as const, app }));

    const bridgeResults = bridgeApps
      .filter((app) => matches([
        app.manifest.id,
        app.manifest.name,
        app.manifest.description,
        app.manifest.kind,
        ...(app.manifest.actions ?? []).map((action) => `${action.name} ${action.description}`),
      ]))
      .map((app) => ({ type: 'bridge-app' as const, app }));

    return [...agentResults, ...liveResults, ...bridgeResults];
  }, [appCards, bridgeApps, currentLocale, intent, liveApps, recommendedAgentApps, t]);

  const recentOpenedLiveApps = useMemo<DiscoverRecommendationItem[]>(() => {
    const recentIds = Array.from(new Set([...runningAppIds].reverse().concat(recentAppIds)));
    if (recentIds.length === 0) return [];
    const appById = new Map(liveApps.map((app) => [app.id, app]));
    return recentIds
      .map((id) => appById.get(id))
      .filter((app): app is LiveAppMeta => Boolean(app))
      .slice(0, 3)
      .map((app) => ({ type: 'live-app' as const, app }));
  }, [liveApps, recentAppIds, runningAppIds]);

  const recommendedItems = useMemo<DiscoverRecommendationItem[]>(
    () => recommendedAgentApps.map((app) => ({ type: 'agent-app' as const, app })),
    [recommendedAgentApps],
  );

  const manageTabs = useMemo(() => ([
    {
      id: 'all' as AppsTab,
      count: appCards.length + liveApps.length + bridgeApps.length,
    },
    {
      id: 'agent-app' as AppsTab,
      count: appCards.length,
    },
    {
      id: 'live-app' as AppsTab,
      count: liveApps.length,
    },
    {
      id: 'bridge-app' as AppsTab,
      count: bridgeApps.length,
    },
  ]), [appCards.length, bridgeApps.length, liveApps.length]);

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
  const selectedLiveAppMeta = selectedLiveApp ? resolveLiveAppMeta(selectedLiveApp, currentLocale) : null;
  const pendingDeleteApp = liveApps.find((app) => app.id === pendingDeleteId);
  const pendingDeleteAppName = pendingDeleteApp ? resolveLiveAppMeta(pendingDeleteApp, currentLocale).name : '';

  const handleOpenLiveApp = (appId: string) => {
    setSelectedLiveApp(null);
    openLiveAppInStore(appId);
    openWorkspaceScene(`live-app:${appId}` as WorkspaceSceneId);
  };

  const handleOpenStudio = useCallback(async () => {
    try {
      await launchWorkForChoice({
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
      await launchWorkForChoice({
        agentChoice: 'AgentAppStudio',
        workspace: null,
        rememberWorkspace,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      notificationService.error(`${t('page.newAgentApp')}: ${reason}`);
    }
  }, [rememberWorkspace, t]);

  const handleUseSuggestion = useCallback((key: string) => {
    setIntent(t(`discover.suggestions.${key}`));
  }, [t]);

  const handleManageSearch = useCallback(() => {
    const query = intent.trim();
    if (query) {
      setSearchQuery(query);
      setLiveSearch(query);
    }
    setHomeView('manage');
  }, [intent, setHomeView, setSearchQuery, setLiveSearch]);

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
          name: resolveLiveAppMeta(app, currentLocale).name,
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
      const [apps, recent, running, runtime] = await Promise.all([
        liveAppAPI.listLiveApps(),
        liveAppAPI.listRecentLiveApps(),
        liveAppAPI.workerListRunning(),
        liveAppAPI.runtimeStatus(),
      ]);
      setLiveApps(apps);
      setRecentAppIds(recent);
      setRunningIds(running);
      setRuntimeStatus(runtime);
    } finally { setLiveLoading(false); }
  }, [setLiveApps, setLiveLoading, setRecentAppIds, setRunningIds, setRuntimeStatus]);

  useEffect(() => {
    void refetchLive();
  }, [refetchLive]);

  useGallerySceneAutoRefresh({ sceneId: 'apps', refetch: refetchLive });

  const refetchBridgeApps = useCallback(async () => {
    setBridgeLoading(true);
    try {
      const apps = await bridgeAppAPI.listBridgeApps();
      setBridgeApps(apps);
      setSelectedBridgeAppId((current) => current ?? apps[0]?.manifest.id ?? null);
    } catch (error) {
      log.error('Bridge App list failed', { error });
    } finally {
      setBridgeLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetchBridgeApps();
  }, [refetchBridgeApps]);

  const selectedBridgeApp = useMemo(
    () => bridgeApps.find((app) => app.manifest.id === selectedBridgeAppId) ?? bridgeApps[0] ?? null,
    [bridgeApps, selectedBridgeAppId],
  );

  const handleSelectBridgeApp = useCallback((app: BridgeAppPackage) => {
    setSelectedBridgeAppId(app.manifest.id);
    setBridgeRunResult(null);
    setHomeView('manage');
    setActiveTab('bridge-app');
  }, [setActiveTab, setHomeView]);

  const handleRunBridgeApp = useCallback(async (
    app: BridgeAppPackage,
    action: BridgeAppAction,
    input: Record<string, unknown>,
    capability?: BridgeAppCapability,
  ) => {
    setBridgeRunning(true);
    setBridgeRunResult(null);
    try {
      const result = await bridgeAppAPI.runBridgeAppAction(
        app.manifest.id,
        action.name,
        input,
        workspacePath || undefined,
        capability?.id,
      );
      setBridgeRunResult(result);
      if (result.status === 'completed') {
        notificationService.success(t('bridgeApp.messages.completed'), { duration: 2400 });
      } else {
        notificationService.error(t('bridgeApp.messages.failed'));
      }
    } catch (error) {
      notificationService.error(
        t('bridgeApp.messages.failedWithReason', {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setBridgeRunning(false);
    }
  }, [t, workspacePath]);

  const effectiveSearch = activeTab === 'live-app' ? liveSearch : searchQuery;
  const onChangeSearch  = activeTab === 'live-app'
    ? (v: string) => {
        setLiveSearch(v);
        setHomeListPage(0);
      }
    : setSearchQuery;

  const handleNavigateAgentApp = useCallback(
    (app: AppCardModel) => {
      openAppDetail(app.id);
    },
    [openAppDetail],
  );

  return (
    <div className="apps-scene">
      <div className="apps-scene__scroll">
        <div className="apps-scene__mode-bar">
          <ModeSwitch
            ariaLabel={t('view.label')}
            value={homeView}
            onChange={(view) => setHomeView(view as AppsHomeView)}
            options={VIEW_KEYS.map((view) => ({
              value: view,
              label: t(`view.${view}`),
            }))}
          />
        </div>
        {homeView === 'discover' && (
          <div className="apps-discover">
            <div className="apps-discover__main">
              <div className="apps-discover__stage">
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
                    }}
                    onSearch={handleManageSearch}
                    onClear={() => {
                      setIntent('');
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
              {intent.trim() ? (
                <section className="apps-discover__recommendations" aria-label={t('discover.searchResults.title')}>
                  <div className="apps-discover__section-head">
                    <h2>{t('discover.searchResults.title')}</h2>
                    <Button variant="secondary" size="small" onClick={() => setHomeView('manage')}>
                      {t('discover.recommendations.manageAll')}
                    </Button>
                  </div>
                  {agentLoading ? (
                    <AppsDiscoverRecommendationsSkeleton />
                  ) : discoverSearchResults.length > 0 ? (
                    <div className="apps-discover__recommended-list">
                      {discoverSearchResults.map((item) => (
                        <DiscoverRecommendationCard
                          key={`${item.type}:${appItemId(item)}`}
                          item={item}
                          isOpen={item.type === 'live-app' ? openedIdSet.has(item.app.id) : false}
                          isRunning={item.type === 'live-app' ? runningIdSet.has(item.app.id) : false}
                          runtimeAvailable={runtimeStatus?.available ?? false}
                          onNavigateAgentApp={handleNavigateAgentApp}
                          onOpenLiveApp={handleOpenLiveApp}
                          onSelectBridgeApp={handleSelectBridgeApp}
                          getModelDisplayName={getModelDisplayName}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="apps-scene__empty">
                      <p>{t('discover.searchResults.empty')}</p>
                      <div className="apps-discover__empty-actions">
                        <Button variant="secondary" onClick={handleOpenStudio}>
                          <PencilRuler size={14} />
                          <span>{t('discover.actions.createLiveApp')}</span>
                        </Button>
                        <Button variant="secondary" onClick={handleOpenAgentAppStudio}>
                          <SparoAgentIcon size={14} />
                          <span>{t('discover.actions.createAgentApp')}</span>
                        </Button>
                      </div>
                    </div>
                  )}
                </section>
              ) : (
                <>
                  <section className="apps-discover__recommendations" aria-label={t('discover.recommendations.title')}>
                    <div className="apps-discover__section-head">
                      <h2>{t('discover.recommendations.title')}</h2>
                      <Button variant="secondary" size="small" onClick={() => setHomeView('manage')}>
                        {t('discover.recommendations.manageAll')}
                      </Button>
                    </div>
                    {agentLoading ? (
                      <AppsDiscoverRecommendationsSkeleton />
                    ) : recommendedItems.length > 0 ? (
                      <div className="apps-discover__recommended-list apps-discover__recommended-list--row">
                        {recommendedItems.map((item) => (
                          <DiscoverRecommendationCard
                            key={`${item.type}:${appItemId(item)}`}
                            item={item}
                            isOpen={false}
                            isRunning={false}
                            runtimeAvailable={runtimeStatus?.available ?? false}
                            onNavigateAgentApp={handleNavigateAgentApp}
                            onOpenLiveApp={handleOpenLiveApp}
                            onSelectBridgeApp={handleSelectBridgeApp}
                            getModelDisplayName={getModelDisplayName}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="apps-scene__empty">
                        <p>{t('discover.recommendations.empty')}</p>
                      </div>
                    )}
                  </section>

                  <section className="apps-discover__recommendations" aria-label={t('discover.recentOpened.title')}>
                    <div className="apps-discover__section-head">
                      <h2>{t('discover.recentOpened.title')}</h2>
                    </div>
                    {liveLoading ? (
                      <AppsDiscoverRecommendationsSkeleton />
                    ) : recentOpenedLiveApps.length > 0 ? (
                      <div className="apps-discover__recommended-list apps-discover__recommended-list--row">
                        {recentOpenedLiveApps.map((item) => (
                          <DiscoverRecommendationCard
                            key={`${item.type}:${appItemId(item)}`}
                            item={item}
                            isOpen={item.type === 'live-app' ? openedIdSet.has(item.app.id) : false}
                            isRunning={item.type === 'live-app' ? runningIdSet.has(item.app.id) : false}
                            runtimeAvailable={runtimeStatus?.available ?? false}
                            onNavigateAgentApp={handleNavigateAgentApp}
                            onOpenLiveApp={handleOpenLiveApp}
                            onSelectBridgeApp={handleSelectBridgeApp}
                            getModelDisplayName={getModelDisplayName}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="apps-scene__empty apps-scene__empty--compact">
                        <p>{t('discover.recentOpened.empty')}</p>
                      </div>
                    )}
                  </section>
                </>
              )}
              </div>
            </div>
          </div>
        )}

        {homeView === 'manage' && (
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
                    <Button size="small" variant="secondary" onClick={refetchBridgeApps} disabled={bridgeLoading} title={t('bridgeApp.actions.refresh')}>
                      <RefreshCw size={14} />
                      <span>{t('bridgeApp.actions.refresh')}</span>
                    </Button>
                  )}
                </div>
              </header>

              <section className="apps-manage__content" ref={manageContentRef}>
                {activeTab === 'all' && (
                  (agentLoading || liveLoading || bridgeLoading) && appCards.length === 0 && liveApps.length === 0 && bridgeApps.length === 0 ? (
                    <AppsListSkeleton rowCount={managePageSize} showActions />
                  ) : filteredAllApps.length === 0 ? (
                    <div className="apps-scene__empty">
                      <LayoutGrid size={28} strokeWidth={1.5} />
                      <p>{t('manage.emptyAll')}</p>
                    </div>
                  ) : (
                    <div className="apps-scene__list-block">
                      <div className="apps-scene__list">
                        {pagedAllApps.map((item) => (
                          item.type === 'agent-app' ? (
                            <AgentAppRow
                              key={`agent-app:${item.app.id}`}
                              app={item.app}
                              onNavigate={handleNavigateAgentApp}
                              getModelDisplayName={getModelDisplayName}
                            />
                          ) : item.type === 'live-app' ? (
                            <LiveAppRow
                              key={`live-app:${item.app.id}`}
                              app={item.app}
                              isOpen={openedIdSet.has(item.app.id)}
                              isRunning={runningIdSet.has(item.app.id)}
                              runtimeAvailable={runtimeStatus?.available ?? false}
                              onOpenDetails={setSelectedLiveApp}
                              onOpen={handleOpenLiveApp}
                              onInstallDeps={handleInstallDeps}
                              onRecompile={handleRecompile}
                              onStop={handleStopLiveApp}
                              onDelete={setPendingDeleteId}
                            />
                          ) : (
                            <BridgeAppRow
                              key={`bridge-app:${item.app.manifest.id}`}
                              app={item.app}
                              isSelected={selectedBridgeAppId === item.app.manifest.id}
                              onSelect={handleSelectBridgeApp}
                            />
                          )
                        ))}
                      </div>
                      <AppsListPagination
                        pageIndex={homeListPage}
                        totalPages={allListTotalPages}
                        onChange={setHomeListPage}
                      />
                    </div>
                  )
                )}

                {activeTab === 'agent-app' && (
                  agentLoading ? (
                    <AppsListSkeleton rowCount={managePageSize} />
                  ) : filteredAgentApps.length === 0 ? (
                    <div className="apps-scene__empty">
                      <SparoAgentIcon size={28} strokeWidth={1.5} />
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
                            getModelDisplayName={getModelDisplayName}
                          />
                        ))}
                      </div>
                      <AppsListPagination
                        pageIndex={homeListPage}
                        totalPages={agentListTotalPages}
                        onChange={setHomeListPage}
                      />
                    </div>
                  )
                )}

                {activeTab === 'live-app' && (
                  liveLoading && liveApps.length === 0 ? (
                    <AppsListSkeleton rowCount={managePageSize} showActions />
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
                            onStop={handleStopLiveApp}
                            onDelete={setPendingDeleteId}
                          />
                        ))}
                      </div>
                      <AppsListPagination
                        pageIndex={homeListPage}
                        totalPages={liveListTotalPages}
                        onChange={setHomeListPage}
                      />
                    </div>
                  )
                )}

                {activeTab === 'bridge-app' && (
                  <div className="apps-bridge-workbench">
                    <div className="apps-bridge-workbench__list">
                      {bridgeLoading && bridgeApps.length === 0 ? (
                        <AppsListSkeleton rowCount={managePageSize} />
                      ) : filteredBridgeApps.length === 0 ? (
                        <div className="apps-scene__empty">
                          <Cable size={28} strokeWidth={1.5} />
                          <p>{t('bridgeApp.empty')}</p>
                        </div>
                      ) : (
                        <div className="apps-scene__list-block">
                          <div className="apps-scene__list">
                            {pagedBridgeApps.map((app) => (
                              <BridgeAppRow
                                key={app.manifest.id}
                                app={app}
                                isSelected={selectedBridgeApp?.manifest.id === app.manifest.id}
                                onSelect={handleSelectBridgeApp}
                              />
                            ))}
                          </div>
                          <AppsListPagination
                            pageIndex={homeListPage}
                            totalPages={bridgeListTotalPages}
                            onChange={setHomeListPage}
                          />
                        </div>
                      )}
                    </div>
                    <BridgeAppRunner
                      app={selectedBridgeApp}
                      workspacePath={workspacePath}
                      onRun={handleRunBridgeApp}
                      running={bridgeRunning}
                      result={bridgeRunResult}
                    />
                  </div>
                )}
              </section>
            </main>
          </div>
        )}

      </div>

      {/* -- Live App detail modal ------------------------------------ */}
      <GalleryDetailModal
        isOpen={Boolean(selectedLiveApp)}
        onClose={() => setSelectedLiveApp(null)}
        icon={renderLiveAppIcon(selectedLiveApp?.icon || 'live-app', 24)}
        iconSurface="plain"
        title={selectedLiveAppMeta?.name ?? ''}
        badges={selectedLiveApp?.category ? <Badge variant="info">{getAppCategoryLabel(selectedLiveApp.category, t)}</Badge> : null}
        description={selectedLiveAppMeta?.description}
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
            <Button variant="primary" size="small" onClick={() => handleOpenLiveApp(selectedLiveApp.id)}>
              <Play size={14} />
              {selectedRuntimeSummary?.runtimeAvailable ? t('liveApp.detail.open') : t('liveApp.actions.openAnyway')}
            </Button>
            <Button variant="danger" size="small" onClick={() => setPendingDeleteId(selectedLiveApp.id)}>
              <Trash2 size={14} />{t('liveApp.detail.delete')}
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
        {selectedLiveAppMeta?.tags.length ? (
          <div className="apps-scene__detail-tags">
            {selectedLiveAppMeta.tags.map((tag) => (
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
        title={t('liveApp.confirmDelete.title', { name: pendingDeleteAppName })}
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

// -----------------------------------------------------------------------------
// Root
// -----------------------------------------------------------------------------

const AppsScene: React.FC = () => {
  const { page, selectedAppId, openHome } = useAppsStore();

  const appsData = useAppsData();
  const { getAppById, loadAppsData } = appsData;

  useGallerySceneAutoRefresh({ sceneId: 'apps', refetch: () => void loadAppsData() });

  const selectedApp = useMemo(() => getAppById(selectedAppId), [getAppById, selectedAppId]);

  if (
    page === 'app-detail' &&
    selectedApp &&
    (selectedApp.kind === 'multi-agent-app' || selectedApp.kind === 'standalone-agent-app')
  ) {
    return <AppDetailScene app={selectedApp} appsData={appsData} onBack={openHome} />;
  }

  return <AppsHomeView appsData={appsData} />;
};

export default AppsScene;


