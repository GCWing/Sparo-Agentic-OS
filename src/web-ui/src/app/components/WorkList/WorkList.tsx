import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Archive, Info, XCircle } from 'lucide-react';
import { EmptyState, IconButton } from '@/design-system';
import { useI18n } from '@/infrastructure/i18n';
import { useWorks } from '@/app/agentic-os/work/hooks/useWorks';
import { useWorkStore } from '@/app/agentic-os/work/data/workStore';
import { openWork, openWorkInCenter } from '@/app/agentic-os/work/navigation/openWork';
import type { WorkStatus } from '@/app/agentic-os/work/domain/workTypes';
import type { WorkProjection } from '@/app/agentic-os/work/projections/workProjection';
import { WorkIcon } from '@/app/agentic-os/work/presentation/WorkIcon';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import {
  getWorkToneValue,
  isFocusStatus,
  isInstrumentedStatus,
  selectWorksForDockList,
  statusKey,
} from './workListSelection';
import './WorkList.scss';

const log = createLogger('WorkList');

interface IndexedWorkProjection {
  work: WorkProjection;
  index: number;
}

interface StableWorkOrder {
  selectionKey: string;
  membershipKey: string;
  workIds: string[];
}

export interface WorkListProps {
  className?: string;
  query?: string;
  maxWorks?: number;
  runningFilter?: 'all' | 'running' | 'not-running';
  includeArchived?: boolean;
  includeCompleted?: boolean;
  activeWorkId?: string | null;
  selectedResultIndex?: number;
  showGroupLabels?: boolean;
  onResultCountChange?: (count: number) => void;
}

function isCancellableStatus(status: WorkStatus): boolean {
  return status === 'running' || status === 'waiting_user' || status === 'blocked';
}

function groupKey(work: WorkProjection): 'running' | 'active' | 'done' {
  if (isFocusStatus(work.status)) {
    return 'running';
  }
  if (
    work.status === 'completed'
    || work.status === 'failed'
    || work.status === 'cancelled'
    || work.status === 'interrupted'
    || work.status === 'archived'
  ) {
    return 'done';
  }
  return 'active';
}

const WorkList: React.FC<WorkListProps> = ({
  className,
  query = '',
  maxWorks,
  runningFilter = 'all',
  includeArchived = false,
  includeCompleted = true,
  activeWorkId = null,
  selectedResultIndex = -1,
  showGroupLabels = false,
  onResultCountChange,
}) => {
  const { t } = useI18n('common');
  const { works, projections, loading, error, refreshWorks } = useWorks();
  const getWork = useWorkStore((state) => state.getWork);
  const controlWork = useWorkStore((state) => state.controlWork);
  const stableOrderRef = useRef<StableWorkOrder | null>(null);

  const workById = useMemo(() => new Map(works.map((work) => [work.id, work])), [works]);

  const visibleWorks = useMemo(() => {
    const candidates = selectWorksForDockList(projections, {
      query,
      runningFilter,
      includeArchived,
      includeCompleted,
    });
    const selectionKey = JSON.stringify({ query, runningFilter, includeArchived, includeCompleted });
    const membershipKey = JSON.stringify(candidates.map((work) => work.id).sort());
    let stableOrder = stableOrderRef.current;

    if (
      !stableOrder
      || stableOrder.selectionKey !== selectionKey
      || stableOrder.membershipKey !== membershipKey
    ) {
      stableOrder = {
        selectionKey,
        membershipKey,
        workIds: candidates.map((work) => work.id),
      };
      stableOrderRef.current = stableOrder;
    }

    const orderByWorkId = new Map(
      stableOrder.workIds.map((workId, index) => [workId, index])
    );
    const stableCandidates = [...candidates].sort(
      (left, right) => (orderByWorkId.get(left.id) ?? 0) - (orderByWorkId.get(right.id) ?? 0)
    );

    return typeof maxWorks === 'number' ? stableCandidates.slice(0, maxWorks) : stableCandidates;
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
      const record = workById.get(projection.id)
        ?? await getWork({ scope: projection.scope, workId: projection.id });
      await openWork(record);
    } catch (openError) {
      log.error('Failed to open work', { workId: projection.id, error: openError });
      notificationService.error(t('nav.workDock.openFailed'));
    }
  }, [getWork, t, workById]);

  const handleCancel = useCallback(async (work: WorkProjection) => {
    try {
      await controlWork({ locator: { scope: work.scope, workId: work.id }, action: 'cancel_current_execution' });
    } catch (cancelError) {
      log.error('Failed to cancel work execution', { workId: work.id, error: cancelError });
      notificationService.error(t('nav.workDock.cancelFailed'));
    }
  }, [controlWork, t]);

  const handleArchive = useCallback(async (work: WorkProjection) => {
    try {
      await controlWork({ locator: { scope: work.scope, workId: work.id }, action: 'archive' });
    } catch (archiveError) {
      log.error('Failed to archive work from Work Dock', { workId: work.id, error: archiveError });
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
            const active = work.id === activeWorkId;
            const showCancelAction = isCancellableStatus(work.status);
            const showArchiveAction = !showCancelAction && work.status !== 'archived';
            const statusClass = statusKey(work.status);
            const instrumented = isInstrumentedStatus(work.status);
            return (
              <article
                key={work.id}
                className={[
                  'work-list__item',
                  `work-list__item--${statusClass}`,
                  instrumented && 'has-state-instrument',
                  active && 'is-active',
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
                  aria-current={active ? 'page' : undefined}
                >
                  <span className="work-list__item-icon" aria-hidden>
                    <span className="work-list__item-icon-glyph">
                      <WorkIcon work={work} size={16} />
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
                    <Info size={13} aria-hidden />
                  </IconButton>
                  {showCancelAction ? (
                    <IconButton
                      type="button"
                      className="work-list__item-action"
                      size="xs"
                      variant="ghost"
                      aria-label={t('nav.workDock.cancelRunningWork')}
                      tooltip={t('nav.workDock.cancelRunningWork')}
                      onClick={() => void handleCancel(work)}
                    >
                      <XCircle size={13} aria-hidden />
                    </IconButton>
                  ) : showArchiveAction ? (
                    <IconButton
                      type="button"
                      className="work-list__item-action"
                      size="xs"
                      variant="ghost"
                      aria-label={t('nav.workDock.removeWork')}
                      tooltip={t('nav.workDock.removeWork')}
                      onClick={() => void handleArchive(work)}
                    >
                      <Archive size={13} aria-hidden />
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
