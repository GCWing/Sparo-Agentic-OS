import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mail } from 'lucide-react';
import {
  Button,
  FullOpenIcon,
  IconButton,
  Panel,
  PanelBody,
  SparoHubIcon,
  useDialogFocusTrap,
} from '@/design-system';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import { systemRuntimeScope } from '@/shared/types/runtime-scope';
import { useDailyLetterArrivalStore } from '@/app/daily-letter-arrival/store/dailyLetterArrivalStore';
import { useWorkStore } from '@/app/agentic-os/work/data/workStore';
import { selectWorkProjections } from '@/app/agentic-os/work/data/workSelectors';
import {
  isDockEligibleWork,
  isWorkAttentionStatus,
  isWorkRunningStatus,
} from '@/app/agentic-os/work/domain/workClassification';
import { openWorkCenterHome } from '@/app/agentic-os/work/navigation/openWork';
import type { WorkspaceSceneId } from '@/app/navigation/workspaceSceneTypes';
import { NewWorkDialog, type NewWorkAgentChoice } from '../WorkDock/NewWorkDialog';
import { openWorkspaceScene } from '../../navigation/workspaceNavigation';
import { useWorkspaceSurfaceStore } from '../../navigation/workspaceSurfaceStore';
import { WorkspaceHubPreview } from './previews/WorkspaceHubPreviewRegistry';
import { WorkspaceHubUtilityRail } from './WorkspaceHubUtilityRail';
import {
  WORKSPACE_HUB_ITEM_DEFINITIONS,
  getWorkspaceHubItem,
  renderWorkspaceHubItemIcon,
  resolveWorkspaceHubItem,
  type WorkspaceHubItemId,
  type WorkspaceHubPreviewItemId,
} from './workspaceHubItems';
import './WorkspaceFooterActions.scss';

const HUB_PREVIEW_ITEM_ROWS = [
  ['work-center', 'apps'],
  ['daily-letter', 'memory'],
  ['files', 'shell'],
] as const satisfies readonly (readonly WorkspaceHubPreviewItemId[])[];

const HUB_PREVIEW_ITEM_IDS = HUB_PREVIEW_ITEM_ROWS.flat();
const HUB_PREVIEW_ITEM_ID_SET = new Set<string>(HUB_PREVIEW_ITEM_IDS);
const HUB_DIRECT_ITEM_IDS = ['skills', 'tools', 'subagents', 'settings'] as const satisfies readonly WorkspaceHubItemId[];
const HUB_LAST_SELECTED_PREVIEW_STORAGE_KEY = 'sparo.workspaceHub.lastPreview.v1';

type WorkspaceHubDirectItemId = (typeof HUB_DIRECT_ITEM_IDS)[number];

function isHubPreviewNavigationItem(
  itemId: string,
): itemId is WorkspaceHubPreviewItemId {
  return HUB_PREVIEW_ITEM_ID_SET.has(itemId);
}

function readLastSelectedPreview(): WorkspaceHubPreviewItemId | null {
  try {
    const itemId = window.localStorage.getItem(HUB_LAST_SELECTED_PREVIEW_STORAGE_KEY);
    if (itemId && isHubPreviewNavigationItem(itemId)) return itemId;
    if (itemId !== null) window.localStorage.removeItem(HUB_LAST_SELECTED_PREVIEW_STORAGE_KEY);
  } catch {
    // This preference is best-effort; in-memory selection still works without storage access.
  }
  return null;
}

function writeLastSelectedPreview(itemId: WorkspaceHubPreviewItemId): void {
  try {
    window.localStorage.setItem(HUB_LAST_SELECTED_PREVIEW_STORAGE_KEY, itemId);
  } catch {
    // This preference is best-effort; in-memory selection still works without storage access.
  }
}

const WorkspaceFooterActions: React.FC = () => {
  const { t } = useI18n('common');
  const activeSurface = useWorkspaceSurfaceStore((state) => state.activeSurface);
  const works = useWorkStore((state) => state.works);
  const hasUnreadDailyLetter = useDailyLetterArrivalStore((state) => state.hasUnread);

  const activeItemId = useMemo(() => resolveWorkspaceHubItem(activeSurface), [activeSurface]);
  const projections = useMemo(() => selectWorkProjections(works), [works]);
  const runningWorkCount = useMemo(
    () => projections.filter((work) => (
      isDockEligibleWork(work) && isWorkRunningStatus(work.status)
    )).length,
    [projections],
  );
  const attentionWorkCount = useMemo(
    () => projections.filter((work) => (
      isDockEligibleWork(work) && isWorkAttentionStatus(work.status)
    )).length,
    [projections],
  );

  const [hubOpen, setHubOpen] = useState(false);
  const [hubClosing, setHubClosing] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<WorkspaceHubPreviewItemId>(() => (
    readLastSelectedPreview()
      ?? (isHubPreviewNavigationItem(activeItemId) ? activeItemId : 'work-center')
  ));
  const [newWorkDialogOpen, setNewWorkDialogOpen] = useState(false);
  const [newWorkInitialAgentChoice, setNewWorkInitialAgentChoice] = useState<NewWorkAgentChoice>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selectedItemRef = useRef<HTMLButtonElement | null>(null);
  const detailPrimaryActionRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef(new Map<WorkspaceHubItemId, HTMLButtonElement>());
  const closeAnimationTimerRef = useRef<number | null>(null);

  const closeHub = useCallback(() => {
    if (closeAnimationTimerRef.current !== null) {
      window.clearTimeout(closeAnimationTimerRef.current);
    }
    setHubOpen(false);
    setHubClosing(true);
    closeAnimationTimerRef.current = window.setTimeout(() => {
      setHubClosing(false);
      closeAnimationTimerRef.current = null;
    }, 240);
  }, []);
  const openHub = useCallback(() => {
    if (closeAnimationTimerRef.current !== null) {
      window.clearTimeout(closeAnimationTimerRef.current);
      closeAnimationTimerRef.current = null;
    }
    setHubClosing(false);
    setHubOpen(true);
  }, []);

  const selectPreviewItem = useCallback((itemId: WorkspaceHubPreviewItemId) => {
    setSelectedItemId(itemId);
    writeLastSelectedPreview(itemId);
  }, []);

  useEffect(() => () => {
    if (closeAnimationTimerRef.current !== null) {
      window.clearTimeout(closeAnimationTimerRef.current);
    }
  }, []);
  const toggleHub = useCallback(() => {
    if (hubOpen) {
      closeHub();
      return;
    }
    openHub();
  }, [closeHub, hubOpen, openHub]);

  useDialogFocusTrap({
    enabled: hubOpen,
    containerRef: panelRef,
    initialFocusRef: selectedItemRef,
    restoreFocus: true,
  });

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (hubOpen) panel.removeAttribute('inert');
    else panel.setAttribute('inert', '');
  }, [hubOpen, hubClosing]);

  const labels = useMemo<Record<WorkspaceHubItemId, string>>(() => Object.fromEntries(
    WORKSPACE_HUB_ITEM_DEFINITIONS.map((item) => [item.id, t(item.labelKey)]),
  ) as Record<WorkspaceHubItemId, string>, [t]);

  const capsuleLabel = useMemo(() => {
    if (attentionWorkCount > 0) {
      return t('nav.menuPanel.hub.capsule.attention', { count: attentionWorkCount });
    }
    if (runningWorkCount > 0) {
      return t('nav.menuPanel.hub.capsule.running', { count: runningWorkCount });
    }
    if (hasUnreadDailyLetter) {
      return t('nav.menuPanel.hub.capsule.dailyLetter');
    }
    return t('nav.menuPanel.hub.capsule.default');
  }, [attentionWorkCount, hasUnreadDailyLetter, runningWorkCount, t]);

  const openItem = useCallback(async (itemId: WorkspaceHubItemId) => {
    closeHub();
    const { openTarget } = getWorkspaceHubItem(itemId);
    switch (openTarget.kind) {
      case 'work-center':
        openWorkCenterHome();
        return;
      case 'preview-only':
        return;
      case 'scene':
        openWorkspaceScene(
          openTarget.sceneId,
          'systemScope' in openTarget && openTarget.systemScope
            ? { scope: systemRuntimeScope('os_agent') }
            : {},
        );
    }
  }, [closeHub]);

  const openScene = useCallback((sceneId: WorkspaceSceneId) => {
    closeHub();
    openWorkspaceScene(sceneId);
  }, [closeHub]);

  const startNewWork = useCallback((initialAgentChoice?: NewWorkAgentChoice) => {
    closeHub();
    setNewWorkInitialAgentChoice(initialAgentChoice);
    setNewWorkDialogOpen(true);
  }, [closeHub]);

  const openAbout = useCallback(() => {
    closeHub();
    window.dispatchEvent(new CustomEvent('nav:show-about'));
  }, [closeHub]);

  const focusItem = useCallback((itemId: WorkspaceHubItemId) => {
    window.requestAnimationFrame(() => itemRefs.current.get(itemId)?.focus());
  }, []);

  const handleGroupKeyDown = useCallback((
    event: React.KeyboardEvent<HTMLButtonElement>,
    ids: readonly WorkspaceHubItemId[],
    index: number,
    columns: number,
    moveToDetailOnRight = false,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = ids.length - 1;
    if (event.key === 'ArrowRight') {
      if (columns === 1 && moveToDetailOnRight) {
        event.preventDefault();
        detailPrimaryActionRef.current?.focus();
        return;
      }
      nextIndex = Math.min(ids.length - 1, index + 1);
    }
    if (event.key === 'ArrowLeft' && columns > 1) nextIndex = Math.max(0, index - 1);
    if (event.key === 'ArrowDown') nextIndex = Math.min(ids.length - 1, index + columns);
    if (event.key === 'ArrowUp') nextIndex = Math.max(0, index - columns);
    if (nextIndex === null || nextIndex === index) return;
    event.preventDefault();
    focusItem(ids[nextIndex]);
  }, [focusItem]);

  const registerItemRef = useCallback((itemId: WorkspaceHubItemId, element: HTMLButtonElement | null) => {
    if (element) itemRefs.current.set(itemId, element);
    else itemRefs.current.delete(itemId);
  }, []);

  const renderPreviewItem = (
    itemId: (typeof HUB_PREVIEW_ITEM_IDS)[number],
    index: number,
  ) => {
    const selected = selectedItemId === itemId;
    const current = activeItemId === itemId;
    const unread = itemId === 'daily-letter' && hasUnreadDailyLetter;
    const workMeta = itemId === 'work-center' && runningWorkCount > 0
      ? t('nav.menuPanel.hub.states.running', { count: runningWorkCount })
      : null;
    const canOpenDirectly = getWorkspaceHubItem(itemId).openTarget.kind !== 'preview-only';

    return (
      <div
        key={itemId}
        className={`sparo-workspace-hub__preview-item-shell${selected ? ' is-selected' : ''}`}
      >
        <Button
          ref={(element) => {
            registerItemRef(itemId, element);
            if (selected) selectedItemRef.current = element;
          }}
          id={`workspace-hub-item-${itemId}`}
          variant="ghost"
          size="small"
          className="sparo-workspace-hub__preview-item"
          aria-controls="workspace-hub-detail"
          aria-current={current ? 'page' : undefined}
          aria-pressed={selected}
          onClick={() => selectPreviewItem(itemId)}
          onKeyDown={(event) => handleGroupKeyDown(event, HUB_PREVIEW_ITEM_IDS, index, 2)}
        >
          <span className="sparo-workspace-hub__item-icon" aria-hidden="true">
            {renderWorkspaceHubItemIcon(itemId)}
            {unread && <span className="sparo-workspace-hub__unread-dot" />}
          </span>
          <span className="sparo-workspace-hub__item-copy">
            <span className="sparo-workspace-hub__item-label">{labels[itemId]}</span>
            {workMeta && (
              <span className="sparo-workspace-hub__item-meta">{workMeta}</span>
            )}
          </span>
          {unread && (
            <span className="sparo-workspace-hub__sr-only">
              {t('nav.menuPanel.hub.states.unread')}
            </span>
          )}
        </Button>
        {canOpenDirectly && (
          <IconButton
            size="xs"
            variant="primary"
            shape="circle"
            className="sparo-workspace-hub__preview-item-open"
            aria-label={t('nav.menuPanel.hub.actions.openItem', { item: labels[itemId] })}
            tooltip={t('nav.menuPanel.hub.actions.openItem', { item: labels[itemId] })}
            tooltipPlacement="top"
            onClick={() => { void openItem(itemId); }}
          >
            <FullOpenIcon
              size={14}
              strokeWidth={1.8}
              absoluteStrokeWidth
              aria-hidden="true"
            />
          </IconButton>
        )}
      </div>
    );
  };

  const renderDirectItem = (itemId: WorkspaceHubDirectItemId, index: number) => {
    const current = activeItemId === itemId;

    return (
      <Button
        key={itemId}
        ref={(element) => registerItemRef(itemId, element)}
        id={`workspace-hub-item-${itemId}`}
        variant="ghost"
        size="small"
        className={`sparo-workspace-hub__direct-item${itemId === 'settings' ? ' is-wide' : ''}${current ? ' is-current' : ''}`}
        aria-current={current ? 'page' : undefined}
        onClick={() => { void openItem(itemId); }}
        onKeyDown={(event) => handleGroupKeyDown(
          event,
          HUB_DIRECT_ITEM_IDS,
          index,
          3,
        )}
      >
        <span className="sparo-workspace-hub__item-icon" aria-hidden="true">
          {renderWorkspaceHubItemIcon(itemId)}
        </span>
        <span className="sparo-workspace-hub__item-label">{labels[itemId]}</span>
      </Button>
    );
  };

  return (
    <div className="sparo-workspace-footer">
      <div className="sparo-workspace-hub">
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="small"
          shape="pill"
          iconOnly
          className={`sparo-workspace-hub__trigger${hubOpen ? ' is-open' : ''}${hasUnreadDailyLetter ? ' has-unread-letter' : ''}`}
          aria-label={hubOpen
            ? t('nav.menuPanel.hub.trigger.close')
            : t('nav.menuPanel.hub.trigger.open')}
          aria-haspopup="dialog"
          aria-expanded={hubOpen}
          aria-controls={hubOpen ? 'workspace-hub-panel' : undefined}
          data-testid="workspace-footer-more-button"
          onClick={toggleHub}
        >
          <SparoHubIcon
            size={25}
            strokeWidth={1.9}
            absoluteStrokeWidth
            aria-hidden="true"
          />
          {hasUnreadDailyLetter && (
            <span className="sparo-workspace-hub__letter-badge" aria-hidden="true">
              <Mail size={10} strokeWidth={2.4} />
            </span>
          )}
          <span className="sparo-workspace-hub__sr-only">{capsuleLabel}</span>
        </Button>

        {(hubOpen || hubClosing) && (
          <>
            {hubOpen && (
              <div
                className="sparo-workspace-hub__backdrop"
                aria-hidden="true"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) closeHub();
                }}
              />
            )}
            <div
              className={`sparo-workspace-hub__bloom${hubOpen ? ' is-open' : ' is-closing'}`}
              onAnimationEnd={(event) => {
                if (event.target !== event.currentTarget || hubOpen) return;
                if (closeAnimationTimerRef.current !== null) {
                  window.clearTimeout(closeAnimationTimerRef.current);
                  closeAnimationTimerRef.current = null;
                }
                setHubClosing(false);
              }}
            >
              <div className="sparo-workspace-hub__surface-stack">
                <div className="sparo-workspace-hub__seed-socket" aria-hidden="true" />
                <Panel
                  ref={panelRef}
                  id="workspace-hub-panel"
                  variant="elevated"
                  className="sparo-workspace-hub__panel"
                  role="dialog"
                  aria-modal="true"
                  aria-hidden={!hubOpen}
                  aria-label={t('nav.menuPanel.hub.ariaLabel')}
                  tabIndex={hubOpen ? -1 : undefined}
                  onKeyDown={(event) => {
                    if (event.defaultPrevented || event.key !== 'Escape') return;
                    event.preventDefault();
                    event.stopPropagation();
                    closeHub();
                  }}
                >
                  <PanelBody className="sparo-workspace-hub__panel-body">
                    <div className="sparo-workspace-hub__layout">
                      <div className="sparo-workspace-hub__navigation">
                        <div className="sparo-workspace-hub__navigation-scroll">
                          <section className="sparo-workspace-hub__nav-group is-preview">
                            <h2 className="sparo-workspace-hub__nav-group-title">
                              {t('nav.menuPanel.hub.sections.preview')}
                            </h2>
                            <nav
                              className="sparo-workspace-hub__preview-tracks"
                              aria-label={t('nav.menuPanel.hub.aria.preview')}
                            >
                              {HUB_PREVIEW_ITEM_IDS.map(renderPreviewItem)}
                            </nav>
                          </section>

                          <section className="sparo-workspace-hub__nav-group is-direct">
                            <h2 className="sparo-workspace-hub__nav-group-title">
                              {t('nav.menuPanel.hub.sections.direct')}
                            </h2>
                            <nav
                              className="sparo-workspace-hub__direct-list"
                              aria-label={t('nav.menuPanel.hub.aria.direct')}
                            >
                              {HUB_DIRECT_ITEM_IDS.map(renderDirectItem)}
                            </nav>
                          </section>
                        </div>

                        <WorkspaceHubUtilityRail
                          onOpenAbout={openAbout}
                        />
                      </div>

                      <section
                        id="workspace-hub-detail"
                        className="sparo-workspace-hub__detail"
                        aria-labelledby={`workspace-hub-item-${selectedItemId}`}
                      >
                        <WorkspaceHubPreview
                          key={selectedItemId}
                          itemId={selectedItemId}
                          label={labels[selectedItemId]}
                          primaryActionRef={detailPrimaryActionRef}
                           onOpenItem={(itemId) => { void openItem(itemId); }}
                           onOpenScene={openScene}
                          onCreateWork={startNewWork}
                          onClose={closeHub}
                        />
                      </section>
                    </div>
                  </PanelBody>
                </Panel>
              </div>
            </div>
          </>
        )}
      </div>

      {newWorkDialogOpen && (
        <NewWorkDialog
          open
          initialAgentChoice={newWorkInitialAgentChoice}
          onClose={() => {
            setNewWorkDialogOpen(false);
            setNewWorkInitialAgentChoice(undefined);
          }}
        />
      )}
    </div>
  );
};

export default WorkspaceFooterActions;
