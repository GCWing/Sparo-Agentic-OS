import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Brush, ChevronDown, Code2, Info, LayoutDashboard, ListChecks, ListTodo, Pin, Plus, Sparkles, XCircle } from 'lucide-react';
import { Button, IconButton, Search } from '@/design-system';
import { useI18n } from '@/infrastructure/i18n';
import { useWorks } from '@/app/agentic-os/work/hooks/useWorks';
import { useWorkStore } from '@/app/agentic-os/work/data/workStore';
import { openWork, openWorkCenterHome, openWorkInCenter } from '@/app/agentic-os/work/navigation/openWork';
import type { WorkKind, WorkStatus } from '@/app/agentic-os/work/domain/workTypes';
import type { WorkProjection } from '@/app/agentic-os/work/projections/workProjection';
import { isWorkAttentionStatus, isWorkRunningStatus } from '@/app/agentic-os/work/domain/workClassification';
import { useWorkDockStore } from '@/app/stores/workDockStore';
import { useWorkspaceSurfaceStore } from '@/app/navigation/workspaceSurfaceStore';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import WorkList from '../WorkList/WorkList';
import { NewWorkDialog } from './NewWorkDialog';
import './WorkDock.scss';

const log = createLogger('WorkDock');
const DOCK_WORK_LIMIT = 9;
const RUNNING_WORK_COLLAPSED_LIMIT = 5;
const STORAGE_KEY = 'sparo.workDock.expanded';
const STORAGE_PINNED = 'sparo.workDock.pinned';

function readExpandedFromStorage(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeExpandedToStorage(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    /* ignore */
  }
}

function readPinnedFromStorage(): boolean {
  try {
    return localStorage.getItem(STORAGE_PINNED) === 'true';
  } catch {
    return false;
  }
}

function writePinnedToStorage(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_PINNED, String(value));
  } catch {
    /* ignore */
  }
}

function isDockVisibleStatus(status: WorkStatus): boolean {
  return isWorkRunningStatus(status) || isWorkAttentionStatus(status);
}

function isCancellableStatus(status: WorkStatus): boolean {
  return status === 'running' || status === 'waiting_user' || status === 'blocked';
}

function isPixelStatus(status: WorkStatus): boolean {
  return status === 'running';
}

function getWorkModeIcon(kind: WorkKind) {
  if (kind === 'app_workflow') return Sparkles;
  if (kind === 'tracking' || kind === 'recurring') return ListTodo;
  if (kind === 'topic') return Brush;
  return Code2;
}

function getWorkToneValue(status: WorkStatus): string {
  if (status === 'waiting_user' || status === 'blocked') return 'var(--ds-color-warning)';
  if (status === 'failed') return 'var(--ds-color-danger)';
  if (status === 'completed') return 'var(--ds-color-success)';
  return 'var(--ds-color-accent-500)';
}

const WorkDock: React.FC = () => {
  const { t } = useI18n('common');
  const activeSurface = useWorkspaceSurfaceStore((state) => state.activeSurface);
  const workDockOpenNonce = useWorkDockStore((state) => state.workDockOpenNonce);
  const { works, projections } = useWorks();
  const getWork = useWorkStore((state) => state.getWork);
  const controlWork = useWorkStore((state) => state.controlWork);

  const [expanded, setExpanded] = useState<boolean>(readExpandedFromStorage);
  const [pinned, setPinned] = useState<boolean>(readPinnedFromStorage);
  const [surfaceExpanded, setSurfaceExpanded] = useState(false);
  const [listFilterQuery, setListFilterQuery] = useState('');
  const [selectedListResultIndex, setSelectedListResultIndex] = useState(0);
  const [listResultCount, setListResultCount] = useState(0);
  const [newWorkDialogOpen, setNewWorkDialogOpen] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const listSearchInputRef = useRef<HTMLInputElement>(null);
  const lastWorkDockOpenNonceRef = useRef(workDockOpenNonce);

  const workById = useMemo(() => new Map(works.map((work) => [work.id, work])), [works]);

  const runningWorks = useMemo(
    () => projections.filter((work) => isDockVisibleStatus(work.status)).slice(0, RUNNING_WORK_COLLAPSED_LIMIT),
    [projections]
  );
  const runningCount = useMemo(
    () => projections.filter((work) => isDockVisibleStatus(work.status)).length,
    [projections]
  );

  const handleOpenWork = useCallback(async (work: WorkProjection) => {
    const record = workById.get(work.id) ?? await getWork(work.id);
    await openWork(record);
  }, [getWork, workById]);

  const handleCancelWork = useCallback(async (work: WorkProjection) => {
    try {
      await controlWork({ workId: work.id, action: 'cancel_current_execution' });
    } catch (error) {
      log.error('Failed to cancel work from Work Dock', { workId: work.id, error });
      notificationService.error(t('nav.workDock.cancelFailed'));
    }
  }, [controlWork, t]);

  const handleOpenWorkDetails = useCallback((work: WorkProjection) => {
    openWorkInCenter(work.id);
  }, []);

  const handleOpenWorkCenter = useCallback(() => {
    openWorkCenterHome();
  }, []);

  const openWorkDock = useCallback(() => {
    if (activeSurface.kind === 'scene') {
      setSurfaceExpanded(true);
      return;
    }
    setExpanded(true);
    writeExpandedToStorage(true);
  }, [activeSurface.kind]);

  const closeWorkDock = useCallback(() => {
    if (activeSurface.kind === 'scene') {
      setSurfaceExpanded(false);
      return;
    }
    setExpanded(false);
    writeExpandedToStorage(false);
  }, [activeSurface.kind]);

  const toggleWorkDock = useCallback(() => {
    if (activeSurface.kind === 'scene') {
      setSurfaceExpanded((value) => !value);
      return;
    }
    setExpanded((value) => {
      const next = !value;
      writeExpandedToStorage(next);
      return next;
    });
  }, [activeSurface.kind]);

  const togglePinned = useCallback(() => {
    setPinned((value) => {
      const next = !value;
      writePinnedToStorage(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!expanded) setListFilterQuery('');
  }, [expanded]);

  useEffect(() => {
    if (!surfaceExpanded) setListFilterQuery('');
  }, [surfaceExpanded]);

  useEffect(() => {
    setSelectedListResultIndex(0);
  }, [listFilterQuery]);

  useEffect(() => {
    if (listResultCount <= 0) {
      setSelectedListResultIndex(0);
      return;
    }
    setSelectedListResultIndex((current) => Math.min(current, listResultCount - 1));
  }, [listResultCount]);

  useEffect(() => {
    if (!listFilterQuery.trim() || listResultCount <= 0) return;
    const row = panelRef.current?.querySelector<HTMLElement>(
      `[data-sparo-work-list-result-index="${selectedListResultIndex}"]`
    );
    row?.scrollIntoView({ block: 'nearest' });
  }, [listFilterQuery, listResultCount, selectedListResultIndex]);

  useEffect(() => {
    if (workDockOpenNonce === lastWorkDockOpenNonceRef.current) return;
    lastWorkDockOpenNonceRef.current = workDockOpenNonce;
    openWorkDock();
  }, [openWorkDock, workDockOpenNonce]);

  const isSessionSurface = activeSurface.kind === 'dispatcher-home' || activeSurface.kind === 'session';
  const suppressInWorkCenter = activeSurface.kind === 'scene' && activeSurface.sceneId === 'work-center';
  const showExpandedPanel = !suppressInWorkCenter && (
    isSessionSurface ? (expanded || newWorkDialogOpen) : surfaceExpanded
  );
  const liftAboveSurface = activeSurface.kind === 'scene';
  const showCollapsedDock = isSessionSurface && !suppressInWorkCenter;
  const showRunningCollapsedDock = !suppressInWorkCenter && !showExpandedPanel && runningCount > 0;
  const isSearchingWorks = listFilterQuery.trim().length > 0;

  useEffect(() => {
    if (!showExpandedPanel || newWorkDialogOpen) return;
    window.requestAnimationFrame(() => {
      listSearchInputRef.current?.focus();
    });
  }, [newWorkDialogOpen, showExpandedPanel]);

  const handleListSearchKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!listFilterQuery.trim() || listResultCount <= 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedListResultIndex((current) => (current + 1) % listResultCount);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedListResultIndex((current) => (current - 1 + listResultCount) % listResultCount);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const targetSelector = event.shiftKey
        ? `[data-sparo-work-list-result-index="${selectedListResultIndex}"] [data-sparo-work-list-details-action]`
        : `[data-sparo-work-list-result-index="${selectedListResultIndex}"] .work-list__item-main`;
      const row = panelRef.current?.querySelector<HTMLElement>(
        targetSelector
      );
      row?.click();
    }
  }, [listFilterQuery, listResultCount, selectedListResultIndex]);

  useEffect(() => {
    if (!showExpandedPanel || pinned || newWorkDialogOpen) return;
    const handler = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      const root = target instanceof Element ? target : target.parentElement;
      if (root?.closest?.('[data-sparo-ignore-work-dock-outside]')) return;
      if (root?.closest?.('.ds-dialog-overlay')) return;
      closeWorkDock();
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [closeWorkDock, newWorkDialogOpen, pinned, showExpandedPanel]);

  if (!showExpandedPanel && !showCollapsedDock && !showRunningCollapsedDock) {
    return null;
  }

  return (
    <div
      ref={panelRef}
      className={[
        'work-dock',
        showExpandedPanel ? 'work-dock--expanded' : '',
        showRunningCollapsedDock ? 'work-dock--running' : '',
        liftAboveSurface ? 'work-dock--above-scene-chrome' : '',
      ].filter(Boolean).join(' ')}
      aria-label={t('nav.workDock.label')}
      data-testid="work-dock"
      data-sparo-ignore-work-dock-outside
    >
      {showExpandedPanel ? (
        <>
          <div className="work-dock__title-bar">
            <Search
              ref={listSearchInputRef}
              className="work-dock__search-input work-dock__search--pill"
              placeholder={t('nav.workDock.searchPlaceholder')}
              value={listFilterQuery}
              onChange={setListFilterQuery}
              onClear={() => setListFilterQuery('')}
              onKeyDown={handleListSearchKeyDown}
              clearable
              size="small"
              enterToSearch={false}
              inputAriaLabel={t('nav.workDock.searchPlaceholder')}
            />
            <div className="work-dock__title-actions">
              <IconButton
                size="xs"
                variant="ghost"
                className={`work-dock__icon-action${pinned ? ' is-pinned' : ''}`}
                onClick={togglePinned}
                aria-label={pinned ? t('nav.workDock.unpinKeepOpen') : t('nav.workDock.pinKeepOpen')}
                aria-pressed={pinned}
                tooltip={pinned ? t('nav.workDock.unpinKeepOpen') : t('nav.workDock.pinKeepOpen')}
                tooltipPlacement="top"
              >
                <Pin size={12} strokeWidth={2.25} fill={pinned ? 'currentColor' : 'none'} />
              </IconButton>
            </div>
          </div>

          <div className="work-dock__list">
            <WorkList
              query={listFilterQuery}
              maxWorks={DOCK_WORK_LIMIT}
              includeCompleted={isSearchingWorks}
              selectedResultIndex={isSearchingWorks ? selectedListResultIndex : -1}
              onResultCountChange={setListResultCount}
            />
          </div>

          <div className="work-dock__footer">
            <Button
              size="small"
              variant="ghost"
              className="work-dock__new-work-action"
              onClick={() => setNewWorkDialogOpen(true)}
              aria-label={t('nav.workDock.newWorkButton')}
              data-testid="work-dock-new-work"
            >
              <Plus size={13} strokeWidth={2.25} />
              <span>{t('nav.workDock.newWorkButton')}</span>
            </Button>
            <IconButton
              size="xs"
              variant="ghost"
              className="work-dock__icon-action"
              aria-label={t('nav.workDock.openWorkCenter')}
              onClick={handleOpenWorkCenter}
              tooltip={t('nav.workDock.openWorkCenter')}
              tooltipPlacement="top"
              data-testid="work-dock-open-center"
            >
              <LayoutDashboard size={13} strokeWidth={2.25} />
            </IconButton>
          </div>
          <NewWorkDialog open={newWorkDialogOpen} onClose={() => setNewWorkDialogOpen(false)} />
        </>
      ) : showRunningCollapsedDock ? (
          <div className="work-dock__running-panel">
            <div className="work-dock__running-hd">
            <span className="work-dock__running-hd-label">{t('nav.workDock.activeWorksGroupLabel')}</span>
            <span className="work-dock__running-count">{runningCount}</span>
          </div>
          <div className="work-dock__running-rows">
            {runningWorks.map((work) => {
              const ModeIcon = getWorkModeIcon(work.kind);
              const pixelStatus = isPixelStatus(work.status);
              const showCancelAction = isCancellableStatus(work.status);
              return (
                <div
                  key={work.id}
                  className={[
                    'work-dock__running-row-wrap',
                    pixelStatus && 'has-pixel-status',
                  ].filter(Boolean).join(' ')}
                  data-sparo-work-id={work.id}
                  data-sparo-work-title={work.title}
                  style={{ '--work-dock-tone': getWorkToneValue(work.status) } as React.CSSProperties}
                >
                  <button
                    type="button"
                    className="work-dock__running-row"
                    onClick={() => void handleOpenWork(work)}
                    aria-label={work.title}
                  >
                    <div
                      className={[
                        'work-dock__mode-avatar',
                        pixelStatus && 'work-dock__mode-avatar--pixel',
                        `work-dock__mode-avatar--${work.status.replace('_', '-')}`,
                      ].filter(Boolean).join(' ')}
                    >
                      <ModeIcon size={11} />
                    </div>
                    <div className="work-dock__running-row-copy">
                      <span className="work-dock__running-row-title">{work.title}</span>
                    </div>
                  </button>
                  <div className="work-dock__running-row-actions" aria-label={t('nav.workDock.rowActions')}>
                    <IconButton
                      className="work-dock__running-row-action"
                      size="xs"
                      variant="ghost"
                      aria-label={t('nav.workDock.openWork')}
                      tooltip={t('nav.workDock.openWork')}
                      onClick={() => void handleOpenWork(work)}
                    >
                      <ArrowRight size={13} />
                    </IconButton>
                    <IconButton
                      className="work-dock__running-row-action"
                      size="xs"
                      variant="ghost"
                      aria-label={t('nav.workDock.openWorkDetails')}
                      tooltip={t('nav.workDock.openWorkDetails')}
                      onClick={() => handleOpenWorkDetails(work)}
                    >
                      <Info size={13} />
                    </IconButton>
                    {showCancelAction ? (
                      <IconButton
                        className="work-dock__running-row-action work-dock__running-row-action--danger"
                        size="xs"
                        variant="ghost"
                        aria-label={t('nav.workDock.cancelRunningWork')}
                        tooltip={t('nav.workDock.cancelRunningWork')}
                        onClick={() => void handleCancelWork(work)}
                      >
                        <XCircle size={13} />
                      </IconButton>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="work-dock__running-ft">
            <div className="work-dock__running-actions">
              <button
                type="button"
                className="work-dock__open-list-action work-dock__open-list-action--full"
                onClick={toggleWorkDock}
                aria-label={t('actions.more')}
              >
                <ChevronDown size={12} />
                <span>{t('actions.more')}</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <IconButton
          size="small"
          variant="ghost"
          className="work-dock__trigger"
          onClick={toggleWorkDock}
          aria-label={t('nav.workDock.openWorkList')}
          aria-expanded={false}
          tooltip={t('nav.workDock.openWorkList')}
          tooltipPlacement="right"
          data-testid="work-dock-trigger"
        >
          <ListChecks size={15} />
        </IconButton>
      )}
    </div>
  );
};

export default WorkDock;
