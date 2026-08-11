import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutDashboard, ListChecks, PanelLeftClose, Plus } from 'lucide-react';
import {
  Button,
  IconButton,
  PanelPinnedIcon,
  Search,
  SPARO_ICON_OPTICAL_STROKE_WIDTH,
} from '@/design-system';
import { useI18n } from '@/infrastructure/i18n';
import { useWorks } from '@/app/agentic-os/work/hooks/useWorks';
import { WorkIcon } from '@/app/agentic-os/work/presentation/WorkIcon';
import { useWorkStore } from '@/app/agentic-os/work/data/workStore';
import { openWork, openWorkCenterHome } from '@/app/agentic-os/work/navigation/openWork';
import type { WorkStatus } from '@/app/agentic-os/work/domain/workTypes';
import type { WorkProjection } from '@/app/agentic-os/work/projections/workProjection';
import {
  isDockEligibleWork,
  isWorkAttentionStatus,
  isWorkRunningStatus,
} from '@/app/agentic-os/work/domain/workClassification';
import { useWorkDockStore } from '@/app/stores/workDockStore';
import { useWorkspaceSurfaceStore } from '@/app/navigation/workspaceSurfaceStore';
import WorkList from '../WorkList/WorkList';
import {
  getWorkToneValue,
  WORK_DOCK_LIST_LIMIT,
} from '../WorkList/workListSelection';
import { NewWorkDialog } from './NewWorkDialog';
import './WorkDock.scss';

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

const WorkDock: React.FC = () => {
  const { t } = useI18n('common');
  const activeSurface = useWorkspaceSurfaceStore((state) => state.activeSurface);
  const surfaceContext = useWorkspaceSurfaceStore((state) => state.surfaceContext);
  const workDockOpenNonce = useWorkDockStore((state) => state.workDockOpenNonce);
  const { works, projections } = useWorks();
  const getWork = useWorkStore((state) => state.getWork);

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
    () => projections
      .filter((work) => isDockEligibleWork(work) && isDockVisibleStatus(work.status))
      .slice(0, RUNNING_WORK_COLLAPSED_LIMIT),
    [projections]
  );
  const runningCount = useMemo(
    () => projections.filter((work) => isDockEligibleWork(work) && isDockVisibleStatus(work.status)).length,
    [projections]
  );

  const handleOpenWork = useCallback(async (work: WorkProjection) => {
    const record = workById.get(work.id) ?? await getWork({ scope: work.scope, workId: work.id });
    await openWork(record);
  }, [getWork, workById]);

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

  const isSessionSurface = activeSurface.kind === 'agentic-os-home' || activeSurface.kind === 'session';
  const suppressInWorkCenter = activeSurface.kind === 'scene' && activeSurface.sceneId === 'work-center';
  const showExpandedPanel = !suppressInWorkCenter && (
    isSessionSurface ? (expanded || newWorkDialogOpen) : surfaceExpanded
  );
  const liftAboveSurface = activeSurface.kind === 'scene';
  const showCollapsedDock = isSessionSurface && !suppressInWorkCenter;
  const showRunningCollapsedDock = !suppressInWorkCenter && !showExpandedPanel && runningCount > 0;
  const isSearchingWorks = listFilterQuery.trim().length > 0;
  const activeWorkId = surfaceContext?.kind === 'work' ? surfaceContext.workId : null;

  useEffect(() => {
    if (!showExpandedPanel || newWorkDialogOpen) return;
    window.requestAnimationFrame(() => {
      listSearchInputRef.current?.focus();
    });
  }, [newWorkDialogOpen, showExpandedPanel]);

  useEffect(() => {
    if (!showExpandedPanel || newWorkDialogOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeWorkDock();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [closeWorkDock, newWorkDialogOpen, showExpandedPanel]);

  const handleListSearchKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeWorkDock();
      return;
    }

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
  }, [closeWorkDock, listFilterQuery, listResultCount, selectedListResultIndex]);

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
      data-state={showExpandedPanel ? 'expanded' : showRunningCollapsedDock ? 'active' : 'idle'}
      data-sparo-ignore-work-dock-outside
    >
      {showExpandedPanel ? (
        <>
          <header className="work-dock__panel-header">
            <div className="work-dock__heading">
              <strong className="work-dock__title">{t('nav.workDock.title')}</strong>
              <span className="work-dock__subtitle">
                {t('nav.workDock.subtitle', { count: runningCount })}
              </span>
            </div>
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
                <PanelPinnedIcon
                  size={16}
                  strokeWidth={SPARO_ICON_OPTICAL_STROKE_WIDTH.compact}
                  absoluteStrokeWidth
                  aria-hidden="true"
                />
              </IconButton>
              <IconButton
                size="xs"
                variant="ghost"
                className="work-dock__icon-action"
                onClick={closeWorkDock}
                aria-label={t('nav.workDock.collapse')}
                tooltip={t('nav.workDock.collapse')}
                tooltipPlacement="top"
                aria-controls="sparo-work-dock-panel"
              >
                <PanelLeftClose size={16} aria-hidden />
              </IconButton>
            </div>
          </header>

          <div className="work-dock__search-row">
            <Search
              ref={listSearchInputRef}
              className="work-dock__search-input work-dock__search--pill"
              placeholder={t('nav.workDock.searchPlaceholder')}
              value={listFilterQuery}
              onChange={setListFilterQuery}
              onClear={() => setListFilterQuery('')}
              onKeyDown={handleListSearchKeyDown}
              clearable
              size="medium"
              enterToSearch={false}
              inputAriaLabel={t('nav.workDock.searchPlaceholder')}
            />
          </div>

          <div id="sparo-work-dock-panel" className="work-dock__list">
            <WorkList
              query={listFilterQuery}
              maxWorks={WORK_DOCK_LIST_LIMIT}
              includeCompleted={isSearchingWorks}
              activeWorkId={activeWorkId}
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
              <Plus size={14} strokeWidth={2.25} />
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
              <LayoutDashboard size={14} strokeWidth={2.25} />
            </IconButton>
          </div>
          <NewWorkDialog open={newWorkDialogOpen} onClose={() => setNewWorkDialogOpen(false)} />
        </>
      ) : showRunningCollapsedDock ? (
        <nav className="work-dock__running-panel" aria-label={t('nav.workDock.activeWorksGroupLabel')}>
          <div className="work-dock__running-rows">
            {runningWorks.map((work, index) => {
              return (
                <button
                  type="button"
                  key={work.id}
                  className={[
                    'work-dock__running-row',
                    activeWorkId === work.id && 'is-active',
                    work.status === 'failed' && 'work-dock__running-row--failed',
                  ].filter(Boolean).join(' ')}
                  data-sparo-work-id={work.id}
                  data-sparo-work-title={work.title}
                  style={{ '--work-dock-tone': getWorkToneValue(work.status) } as React.CSSProperties}
                  onClick={() => void handleOpenWork(work)}
                  aria-label={`${work.title}, ${t(`nav.workDock.status.${work.status}`)}`}
                  aria-current={activeWorkId === work.id ? 'page' : undefined}
                  title={work.title}
                >
                  <span
                    className={[
                      'work-dock__mode-avatar',
                      `work-dock__mode-avatar--${work.status.replace('_', '-')}`,
                    ].filter(Boolean).join(' ')}
                  >
                    <WorkIcon work={work} size={14} />
                    {index === runningWorks.length - 1 && runningCount > RUNNING_WORK_COLLAPSED_LIMIT ? (
                      <span className="work-dock__overflow-count" aria-hidden>
                        +{runningCount - RUNNING_WORK_COLLAPSED_LIMIT}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
          <Button
            size="small"
            variant="ghost"
            className="work-dock__arc-trigger"
            onClick={openWorkDock}
            aria-label={t('nav.workDock.openWorkList')}
            aria-expanded={false}
            aria-controls="sparo-work-dock-panel"
          >
            <span className="work-dock__arc-trigger-label">{t('nav.workDock.openWorkList')}</span>
          </Button>
        </nav>
      ) : (
        <>
          <IconButton
            size="small"
            variant="ghost"
            className="work-dock__trigger"
            onClick={toggleWorkDock}
            aria-label={t('nav.workDock.openWorkList')}
            aria-expanded={false}
            aria-controls="sparo-work-dock-panel"
            data-testid="work-dock-trigger"
          >
            <span className="work-dock__trigger-surface" aria-hidden>
              <ListChecks size={12} />
            </span>
          </IconButton>
          <span className="work-dock__idle-hint" aria-hidden>
            {t('nav.workDock.idleHint')}
          </span>
        </>
      )}
    </div>
  );
};

export default WorkDock;
