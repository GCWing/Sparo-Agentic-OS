import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Database,
  FolderOpen,
  HardDrive,
  ListFilter,
  Play,
  RefreshCw,
  RotateCw,
  Search as SearchIcon,
  Settings,
  TableProperties,
  XCircle,
} from 'lucide-react';
import {
  Badge,
  IconButton,
  Search,
  Select,
  type BadgeVariant,
  type SelectOption,
} from '@/design-system';
import { useI18n } from '@/infrastructure/i18n';
import { workspaceAPI } from '@/infrastructure/api/service-api/WorkspaceAPI';
import { openWorkspaceScene } from '@/app/navigation/workspaceNavigation';
import { useSettingsStore } from '@/app/scenes/settings/settingsStore';
import type {
  BackgroundProcess,
  BackgroundProcessCategory,
  BackgroundProcessKind,
  BackgroundProcessStatus,
} from '@/app/agentic-os/background-process/domain/backgroundProcessTypes';
import { useBackgroundProcesses } from '@/app/agentic-os/background-process/hooks/useBackgroundProcesses';
import { notificationService } from '@/shared/notification-system';
import './BackgroundProcessBoard.scss';

type StatusFilter = 'all' | 'attention' | 'running' | 'queued' | 'scheduled' | 'idle';
type CategoryFilter = 'all' | BackgroundProcessCategory;

type Translator = (key: string, options?: Record<string, unknown>) => string;

const STATUS_FILTERS: StatusFilter[] = ['all', 'attention', 'running', 'queued', 'scheduled', 'idle'];
const CATEGORY_FILTERS: CategoryFilter[] = ['all', 'memory', 'workspace', 'report', 'system'];

const RUNNING_STATUSES = new Set<BackgroundProcessStatus>(['running']);
const ATTENTION_STATUSES = new Set<BackgroundProcessStatus>(['failed', 'cancelled', 'cooling_down']);
const ACTIVE_STATUSES = new Set<BackgroundProcessStatus>(['running', 'queued', 'scheduled', 'cooling_down']);

function isAttentionStatus(status: BackgroundProcessStatus): boolean {
  return ATTENTION_STATUSES.has(status);
}

function statusMatchesFilter(status: BackgroundProcessStatus, filter: StatusFilter): boolean {
  switch (filter) {
    case 'attention':
      return isAttentionStatus(status);
    case 'running':
      return status === 'running';
    case 'queued':
      return status === 'queued';
    case 'scheduled':
      return status === 'scheduled' || status === 'cooling_down';
    case 'idle':
      return status === 'idle' || status === 'succeeded' || status === 'skipped' || status === 'disabled';
    case 'all':
      return true;
  }
}

function statusBadgeVariant(status: BackgroundProcessStatus): BadgeVariant {
  switch (status) {
    case 'running':
      return 'accent';
    case 'queued':
    case 'scheduled':
    case 'cooling_down':
      return 'warning';
    case 'succeeded':
      return 'success';
    case 'failed':
    case 'cancelled':
      return 'error';
    case 'skipped':
      return 'info';
    case 'disabled':
    case 'idle':
      return 'neutral';
  }
}

function statusIcon(status: BackgroundProcessStatus): React.ReactNode {
  switch (status) {
    case 'running':
      return <Activity size={14} />;
    case 'queued':
    case 'scheduled':
    case 'cooling_down':
      return <Clock3 size={14} />;
    case 'succeeded':
      return <CheckCircle2 size={14} />;
    case 'failed':
      return <AlertTriangle size={14} />;
    case 'cancelled':
      return <XCircle size={14} />;
    case 'skipped':
    case 'disabled':
    case 'idle':
      return <CircleDashed size={14} />;
  }
}

function processIcon(kind: BackgroundProcessKind): React.ReactNode {
  switch (kind) {
    case 'auto_memory_extraction':
    case 'memory_consolidation':
      return <Database size={16} />;
    case 'host_scan':
      return <HardDrive size={16} />;
    case 'workspace_overview_refresh':
      return <TableProperties size={16} />;
    case 'global_daily_report':
    case 'daily_letter':
    case 'global_milestone':
      return <CalendarClock size={16} />;
  }
}

function pathBasename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function compactId(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function scopeLabel(process: BackgroundProcess, t: Translator): string {
  switch (process.scope.kind) {
    case 'system':
      return t('background.scopeLabel.system');
    case 'workspace':
      return pathBasename(process.scope.workspacePath);
    case 'path':
      return pathBasename(process.scope.path);
    case 'session':
      return compactId(process.scope.sessionId);
  }
}

function scopeTitle(process: BackgroundProcess, t: Translator): string {
  switch (process.scope.kind) {
    case 'system':
      return t('background.scopeLabel.system');
    case 'workspace':
      return process.scope.workspacePath;
    case 'path':
      return process.scope.path;
    case 'session':
      return process.scope.sessionId;
  }
}

function processSearchText(process: BackgroundProcess, t: Translator): string {
  return [
    process.id,
    t(`background.kinds.${process.kind}`),
    t(`background.categories.${process.category}`),
    process.title,
    process.trigger ? t(`background.trigger.${process.trigger}`) : '',
    process.phase ? t(`background.phase.${process.phase}`) : '',
    scopeTitle(process, t),
    process.lastError ?? '',
    process.outputRefs.map((ref) => `${ref.label} ${ref.path ?? ''} ${ref.uri ?? ''}`).join(' '),
  ].join(' ');
}

function formatTime(timestamp: number | null | undefined, t: Translator): string {
  if (!timestamp) return t('background.emptyValue');
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return t('background.emptyValue');
  }
}

function formatDuration(process: BackgroundProcess, t: Translator): string {
  if (!process.startedAt) return t('background.emptyValue');
  const end = process.finishedAt ?? Date.now();
  const seconds = Math.max(0, Math.floor((end - process.startedAt) / 1000));
  if (seconds < 60) return t('background.duration.seconds', { count: Math.max(1, seconds) });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('background.duration.minutes', { count: minutes });
  return t('background.duration.hours', { count: Math.floor(minutes / 60) });
}

function resultLabel(process: BackgroundProcess, t: Translator): string {
  if (process.lastError) return process.lastError;
  if (process.lastResult) {
    return process.lastResult.message || t(`background.status.${process.lastResult.status}`);
  }
  if (process.finishedAt) return t(`background.status.${process.status}`);
  return t('background.emptyValue');
}

function createStatusOptions(t: Translator): SelectOption[] {
  return STATUS_FILTERS.map((value) => ({
    value,
    label: t(`background.filters.status.${value}`),
  }));
}

function createCategoryOptions(t: Translator): SelectOption[] {
  return CATEGORY_FILTERS.map((value) => ({
    value,
    label: t(value === 'all' ? 'background.filters.category.all' : `background.categories.${value}`),
  }));
}

interface RailItem {
  key: StatusFilter | CategoryFilter;
  label: string;
  count: number;
  icon: React.ReactNode;
  onClick: () => void;
  active: boolean;
}

interface BackgroundProcessBoardProps {
  showRail?: boolean;
}

const BackgroundProcessBoard: React.FC<BackgroundProcessBoardProps> = ({ showRail = true }) => {
  const { t } = useI18n('scenes/work-center');
  const {
    processes,
    generatedAt,
    loading,
    error,
    runningKind,
    refreshProcesses,
    runProcess,
  } = useBackgroundProcesses();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const setSettingsTab = useSettingsStore((state) => state.setActiveTab);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshProcesses();
    }, 8000);
    return () => window.clearInterval(timer);
  }, [refreshProcesses]);

  const counts = useMemo(() => {
    let running = 0;
    let queued = 0;
    let scheduled = 0;
    let idle = 0;
    let attention = 0;
    const byCategory = new Map<BackgroundProcessCategory, number>([
      ['memory', 0],
      ['workspace', 0],
      ['report', 0],
      ['system', 0],
    ]);

    for (const process of processes) {
      if (process.status === 'running') running += 1;
      if (process.status === 'queued') queued += 1;
      if (process.status === 'scheduled' || process.status === 'cooling_down') scheduled += 1;
      if (statusMatchesFilter(process.status, 'idle')) idle += 1;
      if (isAttentionStatus(process.status)) attention += 1;
      byCategory.set(process.category, (byCategory.get(process.category) ?? 0) + 1);
    }

    return { running, queued, scheduled, idle, attention, byCategory };
  }, [processes]);

  const filteredProcesses = useMemo(() => {
    const query = search.trim().toLowerCase();
    return processes.filter((process) => {
      if (!statusMatchesFilter(process.status, statusFilter)) return false;
      if (categoryFilter !== 'all' && process.category !== categoryFilter) return false;
      if (!query) return true;
      return processSearchText(process, t).toLowerCase().includes(query);
    });
  }, [categoryFilter, processes, search, statusFilter, t]);

  useEffect(() => {
    if (selectedId && filteredProcesses.some((process) => process.id === selectedId)) {
      return;
    }
    setSelectedId(filteredProcesses[0]?.id ?? null);
  }, [filteredProcesses, selectedId]);

  const selectedProcess = useMemo(
    () => filteredProcesses.find((process) => process.id === selectedId) ?? null,
    [filteredProcesses, selectedId]
  );

  const railItems = useMemo<RailItem[]>(() => [
    {
      key: 'all',
      label: t('background.filters.status.all'),
      count: processes.length,
      icon: <ListFilter size={14} />,
      onClick: () => {
        setStatusFilter('all');
        setCategoryFilter('all');
      },
      active: statusFilter === 'all' && categoryFilter === 'all',
    },
    {
      key: 'running',
      label: t('background.filters.status.running'),
      count: counts.running,
      icon: <Activity size={14} />,
      onClick: () => setStatusFilter('running'),
      active: statusFilter === 'running',
    },
    {
      key: 'queued',
      label: t('background.filters.status.queued'),
      count: counts.queued,
      icon: <Clock3 size={14} />,
      onClick: () => setStatusFilter('queued'),
      active: statusFilter === 'queued',
    },
    {
      key: 'scheduled',
      label: t('background.filters.status.scheduled'),
      count: counts.scheduled,
      icon: <CalendarClock size={14} />,
      onClick: () => setStatusFilter('scheduled'),
      active: statusFilter === 'scheduled',
    },
    {
      key: 'attention',
      label: t('background.filters.status.attention'),
      count: counts.attention,
      icon: <AlertTriangle size={14} />,
      onClick: () => setStatusFilter('attention'),
      active: statusFilter === 'attention',
    },
    ...CATEGORY_FILTERS.filter((category): category is BackgroundProcessCategory => category !== 'all').map((category) => ({
      key: category,
      label: t(`background.categories.${category}`),
      count: counts.byCategory.get(category) ?? 0,
      icon: category === 'memory'
        ? <Database size={14} />
        : category === 'workspace'
          ? <HardDrive size={14} />
          : category === 'report'
            ? <CalendarClock size={14} />
            : <Settings size={14} />,
      onClick: () => setCategoryFilter(category),
      active: categoryFilter === category,
    })),
  ], [categoryFilter, counts, processes.length, statusFilter, t]);

  const handleRun = async (process: BackgroundProcess) => {
    try {
      const response = await runProcess(process.kind);
      if (response.started) {
        notificationService.success(t('background.messages.runStarted'), { duration: 2200 });
      } else {
        notificationService.info(
          t('background.messages.runSkipped', {
            reason: response.reason ?? t('background.messages.runSkippedDefault'),
          }),
          { duration: 3000 }
        );
      }
    } catch {
      notificationService.error(t('background.messages.runFailed'));
    }
  };

  const handleOpenOutput = async (process: BackgroundProcess) => {
    const target = process.outputRefs.find((ref) => ref.path)?.path;
    if (!target) {
      notificationService.info(t('background.messages.noOutput'), { duration: 2500 });
      return;
    }

    try {
      await workspaceAPI.revealInExplorer(target);
    } catch {
      notificationService.error(t('background.messages.openOutputFailed'));
    }
  };

  const handleOpenSettings = (process: BackgroundProcess) => {
    setSettingsTab(process.category === 'memory' ? 'memory' : 'basics');
    openWorkspaceScene('settings');
  };

  const renderActions = (process: BackgroundProcess) => {
    const disabled = runningKind === process.kind || RUNNING_STATUSES.has(process.status);
    return (
      <div className="bp-row-actions" onClick={(event) => event.stopPropagation()}>
        {process.actions.includes('run_now') && (
          <IconButton
            aria-label={t('background.actions.runNow')}
            tooltip={t('background.actions.runNow')}
            size="small"
            disabled={disabled}
            onClick={() => void handleRun(process)}
          >
            <Play size={14} />
          </IconButton>
        )}
        {process.actions.includes('retry') && (
          <IconButton
            aria-label={t('background.actions.retry')}
            tooltip={t('background.actions.retry')}
            size="small"
            disabled={disabled}
            onClick={() => void handleRun(process)}
          >
            <RotateCw size={14} />
          </IconButton>
        )}
        {process.actions.includes('open_output') && (
          <IconButton
            aria-label={t('background.actions.openOutput')}
            tooltip={t('background.actions.openOutput')}
            size="small"
            onClick={() => void handleOpenOutput(process)}
          >
            <FolderOpen size={14} />
          </IconButton>
        )}
        {process.actions.includes('open_settings') && (
          <IconButton
            aria-label={t('background.actions.openSettings')}
            tooltip={t('background.actions.openSettings')}
            size="small"
            onClick={() => handleOpenSettings(process)}
          >
            <Settings size={14} />
          </IconButton>
        )}
      </div>
    );
  };

  return (
    <div
      className={['bp-board', !showRail && 'bp-board--no-rail'].filter(Boolean).join(' ')}
      data-testid="background-process-board"
    >
      {showRail && (
        <aside className="bp-rail" aria-label={t('background.filters.railLabel')}>
          <div className="bp-rail__head">
            <span className="bp-rail__eyebrow">{t('background.rail.eyebrow')}</span>
            <span className="bp-rail__summary">
              {t('background.rail.summary', {
                running: counts.running,
                attention: counts.attention,
              })}
            </span>
          </div>
          <div className="bp-rail__items">
            {railItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={[
                  'bp-rail__item',
                  item.active && 'bp-rail__item--active',
                ].filter(Boolean).join(' ')}
                onClick={item.onClick}
                aria-pressed={item.active}
              >
                <span className="bp-rail__item-icon">{item.icon}</span>
                <span className="bp-rail__item-label">{item.label}</span>
                <span className="bp-rail__item-count">{item.count}</span>
              </button>
            ))}
          </div>
        </aside>
      )}

      <section className="bp-main" aria-label={t('background.title')}>
        <header className="bp-header">
          <div className="bp-header__title-block">
            <h2>{t('background.title')}</h2>
            <p>
              {t('background.subtitle', {
                running: counts.running,
                attention: counts.attention,
                total: processes.length,
              })}
            </p>
          </div>
          <div className="bp-header__controls">
            <Search
              value={search}
              onChange={setSearch}
              placeholder={t('background.searchPlaceholder')}
              inputAriaLabel={t('background.searchPlaceholder')}
              clearAriaLabel={t('background.actions.clearSearch')}
              size="small"
              prefixIcon={<SearchIcon size={14} />}
              className="bp-search"
            />
            <Select
              value={statusFilter}
              onChange={(value) => setStatusFilter(String(value) as StatusFilter)}
              options={createStatusOptions(t)}
              size="small"
              className="bp-filter-select"
            />
            <Select
              value={categoryFilter}
              onChange={(value) => setCategoryFilter(String(value) as CategoryFilter)}
              options={createCategoryOptions(t)}
              size="small"
              className="bp-filter-select"
            />
            <IconButton
              aria-label={t('background.actions.refresh')}
              tooltip={t('background.actions.refresh')}
              size="small"
              disabled={loading}
              onClick={() => void refreshProcesses()}
            >
              <RefreshCw size={14} className={loading ? 'bp-spin' : undefined} />
            </IconButton>
          </div>
        </header>

        {error && (
          <div className="bp-alert" role="status">
            <AlertTriangle size={14} />
            <span>{t('background.messages.loadFailed')}</span>
          </div>
        )}

        <div className="bp-content">
          <div className="bp-table-wrap">
            {filteredProcesses.length === 0 ? (
              <div className="bp-empty">
                <CircleDashed size={18} />
                <span>
                  {processes.length === 0
                    ? t('background.empty.noProcesses')
                    : t('background.empty.noMatches')}
                </span>
              </div>
            ) : (
              <table className="bp-table">
                <thead>
                  <tr>
                    <th>{t('background.columns.process')}</th>
                    <th>{t('background.columns.status')}</th>
                    <th>{t('background.columns.scope')}</th>
                    <th>{t('background.columns.trigger')}</th>
                    <th>{t('background.columns.phase')}</th>
                    <th>{t('background.columns.runtime')}</th>
                    <th>{t('background.columns.nextRun')}</th>
                    <th>{t('background.columns.result')}</th>
                    <th aria-label={t('background.columns.actions')} />
                  </tr>
                </thead>
                <tbody>
                  {filteredProcesses.map((process) => {
                    const selected = process.id === selectedId;
                    return (
                      <tr
                        key={process.id}
                        className={[
                          'bp-table__row',
                          selected && 'bp-table__row--selected',
                          ACTIVE_STATUSES.has(process.status) && 'bp-table__row--active',
                        ].filter(Boolean).join(' ')}
                        onClick={() => setSelectedId(process.id)}
                      >
                        <td className="bp-process-cell">
                          <span className="bp-process-cell__icon">{processIcon(process.kind)}</span>
                          <span className="bp-process-cell__text">
                            <span className="bp-process-cell__title">{t(`background.kinds.${process.kind}`)}</span>
                            <span className="bp-process-cell__meta">{compactId(process.id)}</span>
                          </span>
                        </td>
                        <td>
                          <Badge
                            variant={statusBadgeVariant(process.status)}
                            className={`bp-status-badge bp-status-badge--${process.status}`}
                          >
                            <span className="bp-status-badge__icon">{statusIcon(process.status)}</span>
                            {t(`background.status.${process.status}`)}
                          </Badge>
                        </td>
                        <td title={scopeTitle(process, t)}>{scopeLabel(process, t)}</td>
                        <td>
                          {process.trigger
                            ? t(`background.trigger.${process.trigger}`)
                            : t('background.emptyValue')}
                        </td>
                        <td>
                          {process.phase
                            ? t(`background.phase.${process.phase}`)
                            : t('background.emptyValue')}
                        </td>
                        <td>{formatDuration(process, t)}</td>
                        <td>{formatTime(process.nextRunAt, t)}</td>
                        <td className="bp-table__result" title={resultLabel(process, t)}>
                          {resultLabel(process, t)}
                        </td>
                        <td>{renderActions(process)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <aside className="bp-detail" aria-label={t('background.detail.label')}>
            {selectedProcess ? (
              <>
                <div className="bp-detail__head">
                  <span className="bp-detail__icon">{processIcon(selectedProcess.kind)}</span>
                  <div>
                    <h3>{t(`background.kinds.${selectedProcess.kind}`)}</h3>
                    <p>{selectedProcess.id}</p>
                  </div>
                </div>
                <dl className="bp-detail__facts">
                  <div>
                    <dt>{t('background.detail.status')}</dt>
                    <dd>{t(`background.status.${selectedProcess.status}`)}</dd>
                  </div>
                  <div>
                    <dt>{t('background.detail.category')}</dt>
                    <dd>{t(`background.categories.${selectedProcess.category}`)}</dd>
                  </div>
                  <div>
                    <dt>{t('background.detail.scope')}</dt>
                    <dd title={scopeTitle(selectedProcess, t)}>{scopeTitle(selectedProcess, t)}</dd>
                  </div>
                  <div>
                    <dt>{t('background.detail.started')}</dt>
                    <dd>{formatTime(selectedProcess.startedAt, t)}</dd>
                  </div>
                  <div>
                    <dt>{t('background.detail.finished')}</dt>
                    <dd>{formatTime(selectedProcess.finishedAt, t)}</dd>
                  </div>
                  <div>
                    <dt>{t('background.detail.activeSession')}</dt>
                    <dd>{selectedProcess.activeSessionId ?? t('background.emptyValue')}</dd>
                  </div>
                </dl>
                <div className="bp-detail__section">
                  <h4>{t('background.detail.outputs')}</h4>
                  {selectedProcess.outputRefs.length === 0 ? (
                    <p>{t('background.empty.noOutputs')}</p>
                  ) : (
                    <ul className="bp-detail__outputs">
                      {selectedProcess.outputRefs.map((ref) => (
                        <li key={`${ref.label}:${ref.path ?? ref.uri ?? ''}`}>
                          <span>{ref.label}</span>
                          <code>{ref.path ?? ref.uri ?? t('background.emptyValue')}</code>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {selectedProcess.lastError && (
                  <div className="bp-detail__error">
                    <AlertTriangle size={14} />
                    <span>{selectedProcess.lastError}</span>
                  </div>
                )}
                <div className="bp-detail__actions">{renderActions(selectedProcess)}</div>
              </>
            ) : (
              <div className="bp-detail__empty">{t('background.empty.selectProcess')}</div>
            )}
          </aside>
        </div>

        <footer className="bp-footer">
          <span>
            {generatedAt
              ? t('background.footer.generatedAt', { time: formatTime(generatedAt, t) })
              : t('background.footer.notLoaded')}
          </span>
        </footer>
      </section>
    </div>
  );
};

export default BackgroundProcessBoard;
