import React, { useCallback, useEffect, useMemo } from 'react';
import { Brush, Clock3, Code2, Info, ListChecks, ListTodo, Sparkles, Trash2, XCircle } from 'lucide-react';
import { EmptyState, IconButton } from '@/design-system';
import { useI18n } from '@/infrastructure/i18n';
import { useWorks } from '@/app/agentic-os/work/hooks/useWorks';
import { useWorkStore } from '@/app/agentic-os/work/data/workStore';
import { openWork, openWorkInCenter } from '@/app/agentic-os/work/navigation/openWork';
import type { WorkKind, WorkStatus } from '@/app/agentic-os/work/domain/workTypes';
import type { WorkProjection } from '@/app/agentic-os/work/projections/workProjection';
import { filterWorkProjections } from '@/app/agentic-os/work/data/workSelectors';
import { isWorkAttentionStatus, isWorkRunningStatus } from '@/app/agentic-os/work/domain/workClassification';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import './WorkList.scss';

const log = createLogger('WorkList');

interface IndexedWorkProjection {
  work: WorkProjection;
  index: number;
}

export interface WorkListProps {
  className?: string;
  query?: string;
  maxWorks?: number;
  runningFilter?: 'all' | 'running' | 'not-running';
  includeArchived?: boolean;
  includeCompleted?: boolean;
  selectedResultIndex?: number;
  showGroupLabels?: boolean;
  onResultCountChange?: (count: number) => void;
}

function isFocusStatus(status: WorkStatus): boolean {
  return isWorkRunningStatus(status) || isWorkAttentionStatus(status);
}

function isCancellableStatus(status: WorkStatus): boolean {
  return status === 'running' || status === 'waiting_user' || status === 'blocked';
}

function groupKey(work: WorkProjection): 'running' | 'active' | 'done' {
  if (isFocusStatus(work.status)) {
    return 'running';
  }
  if (work.status === 'completed' || work.status === 'failed' || work.status === 'archived') {
    return 'done';
  }
  return 'active';
}

function statusKey(status: WorkStatus): string {
  return status.replace(/_/g, '-');
}

function getWorkModeIcon(kind: WorkKind) {
  if (kind === 'app_workflow') return Sparkles;
  if (kind === 'tracking' || kind === 'recurring') return ListTodo;
  if (kind === 'topic') return Brush;
  if (kind === 'long_running_session') return Clock3;
  if (kind === 'one_shot' || kind === 'multi_step' || kind === 'delegated_work') return ListChecks;
  return Code2;
}

function getWorkToneValue(status: WorkStatus): string {
  if (status === 'waiting_user' || status === 'blocked') return 'var(--ds-color-warning)';
  if (status === 'failed') return 'var(--ds-color-danger)';
  if (status === 'completed') return 'var(--ds-color-success)';
  if (status === 'running') return 'var(--ds-color-accent-500)';
  return 'var(--ds-color-text-muted)';
}

function isInstrumentedStatus(status: WorkStatus): boolean {
  return status === 'running'
    || status === 'waiting_user'
    || status === 'blocked'
    || status === 'failed'
    || status === 'paused'
    || status === 'completed';
}

function statusPriority(status: WorkStatus): number {
  switch (status) {
    case 'waiting_user':
      return 0;
    case 'blocked':
      return 1;
    case 'failed':
      return 2;
    case 'running':
      return 3;
    case 'active':
      return 4;
    case 'paused':
      return 5;
    case 'draft':
      return 6;
    case 'completed':
      return 7;
    case 'archived':
      return 8;
  }
}

function kindContinuityPriority(kind: WorkKind): number {
  switch (kind) {
    case 'recurring':
      return 0;
    case 'long_running_session':
    case 'tracking':
    case 'topic':
      return 1;
    case 'app_workflow':
      return 2;
    case 'multi_step':
    case 'delegated_work':
      return 3;
    case 'one_shot':
      return 4;
  }
}

function compareWorksForDock(left: WorkProjection, right: WorkProjection): number {
  const byStatus = statusPriority(left.status) - statusPriority(right.status);
  if (byStatus !== 0) return byStatus;
  const byKind = kindContinuityPriority(left.kind) - kindContinuityPriority(right.kind);
  if (byKind !== 0) return byKind;
  const byTime = right.updatedAt - left.updatedAt;
  if (byTime !== 0) return byTime;
  return left.id.localeCompare(right.id);
}

const WorkList: React.FC<WorkListProps> = ({
  className,
  query = '',
  maxWorks,
  runningFilter = 'all',
  includeArchived = false,
  includeCompleted = true,
  selectedResultIndex = -1,
  showGroupLabels = false,
  onResultCountChange,
}) => {
  const { t } = useI18n('common');
  const { works, projections, loading, error, refreshWorks } = useWorks();
  const getWork = useWorkStore((state) => state.getWork);
  const controlWork = useWorkStore((state) => state.controlWork);

  const workById = useMemo(() => new Map(works.map((work) => [work.id, work])), [works]);

  const visibleWorks = useMemo(() => {
    const filtered = filterWorkProjections(projections, query)
      .filter((work) => {
        const running = isFocusStatus(work.status);
        if (runningFilter === 'running') return running;
        if (runningFilter === 'not-running') return !running;
        return true;
      })
      .filter((work) => (includeArchived ? true : work.status !== 'archived'))
      .filter((work) => (includeCompleted ? true : work.status !== 'completed'))
      .sort(compareWorksForDock);
    return typeof maxWorks === 'number' ? filtered.slice(0, maxWorks) : filtered;
  }, [includeArchived, includeCompleted, maxWorks, projections, query, runningFilter]);

  const indexedVisibleWorks = useMemo<IndexedWorkProjection[]>(
    () => visibleWorks.map((work, index) => ({ work, index })),
    [visibleWorks]
  );

  useEffect(() => {
    onResultCountChange?.(visibleWorks.length);
  }, [onResultCountChange, visibleWorks.length]);

  const handleOpen = useCallback(async (projection: WorkProjection) => {
    try {
      const record = workById.get(projection.id) ?? await getWork(projection.id);
      await openWork(record);
    } catch (openError) {
      log.error('Failed to open work', { workId: projection.id, error: openError });
      notificationService.error(t('nav.workDock.openFailed'));
    }
  }, [getWork, t, workById]);

  const handleCancel = useCallback(async (work: WorkProjection) => {
    try {
      await controlWork({ workId: work.id, action: 'cancel_current_execution' });
    } catch (cancelError) {
      log.error('Failed to cancel work execution', { workId: work.id, error: cancelError });
      notificationService.error(t('nav.workDock.cancelFailed'));
    }
  }, [controlWork, t]);

  const handleRemove = useCallback(async (work: WorkProjection) => {
    try {
      await controlWork({ workId: work.id, action: 'archive' });
    } catch (removeError) {
      log.error('Failed to remove work from Work Dock', { workId: work.id, error: removeError });
      notificationService.error(t('nav.workDock.removeFailed'));
    }
  }, [controlWork, t]);

  const handleOpenDetails = useCallback((work: WorkProjection) => {
    openWorkInCenter(work.id);
  }, []);

  const grouped = useMemo(() => {
    if (!showGroupLabels) {
      return [{ key: 'all', items: indexedVisibleWorks }];
    }
    const groups = new Map<string, IndexedWorkProjection[]>();
    for (const item of indexedVisibleWorks) {
      const { work } = item;
      const key = groupKey(work);
      const current = groups.get(key);
      if (current) current.push(item);
      else groups.set(key, [item]);
    }
    return Array.from(groups.entries()).map(([key, items]) => ({ key, items }));
  }, [indexedVisibleWorks, showGroupLabels]);

  if (error) {
    return (
      <div className={['work-list__list', 'work-list__list--filter-empty', className].filter(Boolean).join(' ')}>
        <EmptyState className="work-list__filter-empty" description={t('nav.workDock.loadFailed')} imageSize="small">
          <button type="button" className="work-list__text-action" onClick={() => void refreshWorks()}>
            {t('nav.workDock.retry')}
          </button>
        </EmptyState>
      </div>
    );
  }

  if (!loading && visibleWorks.length === 0) {
    return (
      <div className={['work-list__list', 'work-list__list--filter-empty', className].filter(Boolean).join(' ')}>
        <EmptyState
          className="work-list__filter-empty"
          description={query ? t('nav.workDock.filterNoMatch') : t('nav.workDock.empty')}
          imageSize="small"
        />
      </div>
    );
  }

  return (
    <div className={['work-list__list', className].filter(Boolean).join(' ')} aria-busy={loading || undefined}>
      {loading && visibleWorks.length === 0 ? (
        <div className="work-list__loading">{t('status.loading')}</div>
      ) : null}

      {grouped.map((group) => (
        <section className="work-list__group" key={group.key}>
          {showGroupLabels && (
            <div className="work-list__group-label">
              {t(`nav.workDock.group.${group.key}`)}
            </div>
          )}
          {group.items.map(({ work, index }) => {
            const selected = index === selectedResultIndex;
            const showCancelAction = isCancellableStatus(work.status);
            const showRemoveAction = !showCancelAction && work.status !== 'archived';
            const ModeIcon = getWorkModeIcon(work.kind);
            const statusClass = statusKey(work.status);
            const instrumented = isInstrumentedStatus(work.status);
            return (
              <article
                key={work.id}
                className={[
                  'work-list__item',
                  `work-list__item--${statusClass}`,
                  instrumented && 'has-state-instrument',
                  selected && 'is-keyboard-active',
                ].filter(Boolean).join(' ')}
                data-sparo-work-list-result-index={index}
                data-sparo-work-id={work.id}
                data-sparo-work-title={work.title}
                style={{ '--work-list-tone': getWorkToneValue(work.status) } as React.CSSProperties}
              >
                <button
                  type="button"
                  className="work-list__item-main"
                  onClick={() => void handleOpen(work)}
                  aria-label={`${work.title}, ${t(`nav.workDock.status.${work.status}`)}`}
                >
                  <span className="work-list__item-icon" aria-hidden>
                    <span className="work-list__item-icon-glyph">
                      <ModeIcon size={15} aria-hidden />
                    </span>
                    {instrumented ? <span className="work-list__item-state-mark" /> : null}
                  </span>
                  <span className="work-list__item-copy">
                    <span className="work-list__item-label">{work.title}</span>
                  </span>
                </button>
                <div className="work-list__item-actions" aria-label={t('nav.workDock.rowActions')}>
                  <IconButton
                    type="button"
                    className="work-list__item-action"
                    size="xs"
                    variant="ghost"
                    aria-label={t('nav.workDock.openWorkDetails')}
                    aria-keyshortcuts="Shift+Enter"
                    tooltip={t('nav.workDock.openWorkDetails')}
                    data-sparo-work-list-details-action
                    onClick={() => handleOpenDetails(work)}
                  >
                    <Info className="work-list__item-action-icon" size={13} aria-hidden />
                  </IconButton>
                  {showCancelAction ? (
                    <IconButton
                      type="button"
                      className="work-list__item-action work-list__item-action--always-visible"
                      size="xs"
                      variant="ghost"
                      aria-label={t('nav.workDock.cancelRunningWork')}
                      tooltip={t('nav.workDock.cancelRunningWork')}
                      onClick={() => void handleCancel(work)}
                    >
                      <XCircle className="work-list__item-action-icon" size={13} aria-hidden />
                    </IconButton>
                  ) : showRemoveAction ? (
                    <IconButton
                      type="button"
                      className="work-list__item-action"
                      size="xs"
                      variant="ghost"
                      aria-label={t('nav.workDock.removeWork')}
                      tooltip={t('nav.workDock.removeWork')}
                      onClick={() => void handleRemove(work)}
                    >
                      <Trash2 className="work-list__item-action-icon" size={13} aria-hidden />
                    </IconButton>
                  ) : null}
                </div>
              </article>
            );
          })}
        </section>
      ))}
    </div>
  );
};

export default WorkList;
