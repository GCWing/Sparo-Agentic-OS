/**
 * SessionCapsule �?floating vertical capsule for session navigation.
 *
 * Replaces the former left sidebar session list.
 *
 * States:
 *   Collapsed �?a small rounded pill on the left edge, vertically centered.
 *               No running tasks: list icon + session count badge (click expands).
 *               With running tasks: every running session shows a mode-colored avatar; click switches.
 *               Below avatars: compact button to expand the full list.
 *   Expanded  �?a tall rounded rectangle (capsule) containing the session list.
 *
 * The panel is position:fixed so it floats over all content.
 * Collapse/expand state is persisted in localStorage.
 *
 * The capsule stays visible over non-home surfaces; UnifiedTopBar "view all tasks" expands
 * this panel instead of opening a separate modal.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, ListChecks, LayoutDashboard, Pin, Plus, Code2, Brush, ListTodo, Sparkles } from 'lucide-react';
import { Button, IconButton, Search, StatusDot } from '@/design-system';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import { flowChatStore } from '../../../flow_chat/store/FlowChatStore';
import type { FlowChatState, Session } from '../../../flow_chat/types/flow-chat';
import { stateMachineManager } from '../../../flow_chat/state-machine';
import { ProcessingPhase, SessionExecutionState } from '../../../flow_chat/state-machine/types';
import {
  openChildSessionInAuxPane,
  openMainSession,
} from '../../../flow_chat/services/childSessionPanels';
import { resolveSessionRelationship } from '../../../flow_chat/utils/sessionMetadata';
import { compareSessionsForDisplay, findOpenedWorkspaceForSession } from '../../../flow_chat/utils/sessionOrdering';
import { createLogger } from '@/shared/utils/logger';
import {
  useRunningLiveAppItems,
  type RunningLiveAppItem,
} from '@/app/scenes/apps/live-app/liveAppTaskView';
import { renderLiveAppIcon } from '@/app/scenes/apps/live-app/liveAppIconHelpers';
import { openWorkspaceScene } from '../../navigation/workspaceNavigation';
import { useWorkspaceSurfaceStore } from '../../navigation/workspaceSurfaceStore';
import { useSessionCapsuleStore } from '../../stores/sessionCapsuleStore';
import SessionList from '../SessionList/SessionList';
import { NewSessionDialog } from './NewSessionDialog';
import './SessionCapsule.scss';

const log = createLogger('SessionCapsule');
/** Default visible rows in the expanded capsule when no search is active. */
const RECENT_SESSION_LIMIT = 7;
const RUNNING_TASK_COLLAPSED_LIMIT = 5;

type CapsuleTone = 'working' | 'waiting' | 'finishing';

interface CapsuleSignal {
  id: string;
  text: string;
  tone: CapsuleTone | 'done';
  targetId?: string;
  targetKind?: 'session' | 'live-app';
}

const getSessionListTitle = (session: Session): string =>
  session.title?.trim() || `Task ${session.sessionId.slice(0, 6)}`;

const getSessionModeIcon = (session: Session) => {
  const mode = session.mode?.toLowerCase();
  if (mode === 'cowork') return ListTodo;
  if (mode === 'design') return Brush;
  if (mode === 'deepresearch' || mode === 'liveappstudio') return Sparkles;
  return Code2;
};

const toneToColor: Record<CapsuleTone | 'done', string> = {
  working: 'var(--ds-color-accent-500)',
  waiting: 'var(--ds-color-warning)',
  finishing: 'var(--ds-color-success)',
  done: 'var(--ds-color-success)',
};

function runningItemId(item: { kind: 'session'; session: Session } | { kind: 'live-app'; app: RunningLiveAppItem }): string {
  return item.kind === 'live-app' ? `live-app:${item.app.id}` : `session:${item.session.sessionId}`;
}

const STORAGE_KEY = 'sparo.sessionCapsule.expanded';
const STORAGE_PINNED = 'sparo.sessionCapsule.pinned';

function readExpandedFromStorage(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function writeExpandedToStorage(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch { /* ignore */ }
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
  } catch { /* ignore */ }
}

const SessionCapsule: React.FC = () => {
  const { t } = useI18n('common');
  const activeSurface = useWorkspaceSurfaceStore((s) => s.activeSurface);
  const openTaskDetail = useSessionCapsuleStore((s) => s.openTaskDetail);
  const sessionListExpandNonce = useSessionCapsuleStore((s) => s.sessionListExpandNonce);
  const { openedWorkspacesList, rememberWorkspace, lastUsedWorkspace } = useWorkspaceContext();

  const [expanded, setExpanded] = useState<boolean>(readExpandedFromStorage);
  const [pinned, setPinned] = useState<boolean>(readPinnedFromStorage);
  const [surfaceExpanded, setSurfaceExpanded] = useState(false);
  const [listFilterQuery, setListFilterQuery] = useState('');
  const [selectedListResultIndex, setSelectedListResultIndex] = useState(0);
  const [listResultCount, setListResultCount] = useState(0);
  const [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false);
  const [runningSectionExpanded, setRunningSectionExpanded] = useState(false);
  const [flowChatState, setFlowChatState] = useState<FlowChatState>(() => flowChatStore.getState());
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const [capsuleSignal, setCapsuleSignal] = useState<CapsuleSignal | null>(null);
  const [completedSignal, setCompletedSignal] = useState<CapsuleSignal | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previousRunningItemsRef = useRef<Map<string, { title: string; kind: 'session' | 'live-app' }>>(new Map());
  const previousWaitingIdsRef = useRef<Set<string>>(new Set());
  const runningSignalsReadyRef = useRef(false);
  const listSearchInputRef = useRef<HTMLInputElement>(null);
  const runningLiveApps = useRunningLiveAppItems();

  useEffect(() => {
    const unsub = flowChatStore.subscribe((s) => setFlowChatState(s));
    return () => unsub();
  }, []);

  const updateRunningSessions = useCallback(() => {
    const running = new Set<string>();
    for (const session of flowChatStore.getState().sessions.values()) {
      if (session.mode === 'Dispatcher') continue;
      const machine = stateMachineManager.get(session.sessionId);
      if (
        machine &&
        (machine.getCurrentState() === SessionExecutionState.PROCESSING ||
          machine.getCurrentState() === SessionExecutionState.FINISHING)
      ) {
        running.add(session.sessionId);
      }
    }
    setRunningSessionIds(running);
  }, []);

  useEffect(() => {
    updateRunningSessions();
    const unsubMachine = stateMachineManager.subscribeGlobal(updateRunningSessions);
    return () => unsubMachine();
  }, [updateRunningSessions, flowChatState.sessions]);

  const activeSessionId = flowChatState.activeSessionId;

  const runningSessionsOrdered = useMemo((): Session[] => {
    if (runningSessionIds.size === 0) return [];
    return Array.from(flowChatState.sessions.values())
      .filter((s) => runningSessionIds.has(s.sessionId))
      .sort(compareSessionsForDisplay);
  }, [runningSessionIds, flowChatState.sessions]);

  const runningItems = useMemo(
    (): Array<
      | { kind: 'session'; session: Session }
      | { kind: 'live-app'; app: RunningLiveAppItem }
    > => [
      ...runningLiveApps.map(app => ({ kind: 'live-app' as const, app })),
      ...runningSessionsOrdered.map(session => ({ kind: 'session' as const, session })),
    ],
    [runningLiveApps, runningSessionsOrdered]
  );

  const getSessionRuntimeDetails = useCallback(
    (session: Session): { label: string; tone: CapsuleTone; isWaiting: boolean } => {
      const machine = stateMachineManager.get(session.sessionId);
      const state = machine?.getCurrentState();
      const context = machine?.getContext();
      const phase = context?.processingPhase;
      const isWaiting =
        phase === ProcessingPhase.TOOL_CONFIRMING ||
        Boolean(context?.pendingToolConfirmations?.size);

      if (isWaiting) {
        return {
          label: t('nav.sessionCapsule.status.waiting'),
          tone: 'waiting',
          isWaiting: true,
        };
      }

      if (state === SessionExecutionState.FINISHING || phase === ProcessingPhase.FINALIZING) {
        return {
          label: t('nav.sessionCapsule.status.finishing'),
          tone: 'finishing',
          isWaiting: false,
        };
      }

      if (phase === ProcessingPhase.TOOL_CALLING) {
        return {
          label: t('nav.sessionCapsule.status.usingTools'),
          tone: 'working',
          isWaiting: false,
        };
      }

      if (phase === ProcessingPhase.STREAMING) {
        return {
          label: t('nav.sessionCapsule.status.writing'),
          tone: 'working',
          isWaiting: false,
        };
      }

      if (phase === ProcessingPhase.COMPACTING) {
        return {
          label: t('nav.sessionCapsule.status.tidyingMemory'),
          tone: 'working',
          isWaiting: false,
        };
      }

      return {
        label: t('nav.sessionCapsule.status.thinking'),
        tone: 'working',
        isWaiting: false,
      };
    },
    [t]
  );

  const handleSwitchToSession = useCallback(
    async (sessionId: string) => {
      try {
        const session = flowChatStore.getState().sessions.get(sessionId);
        const relationship = resolveSessionRelationship(session);
        const parentSessionId = relationship.parentSessionId;
        const resolvedWorkspaceId = session
          ? findOpenedWorkspaceForSession(session, openedWorkspacesList)?.id
          : undefined;
        const mustActivateWorkspace =
          Boolean(resolvedWorkspaceId) && resolvedWorkspaceId !== lastUsedWorkspace?.id;
        const activateWorkspace = mustActivateWorkspace
          ? async (targetWorkspaceId: string) => {
              await rememberWorkspace(targetWorkspaceId);
            }
          : undefined;

        if (relationship.canOpenInAuxPane && parentSessionId && session) {
          await openMainSession(parentSessionId, {
            workspaceId: resolvedWorkspaceId,
            activateWorkspace,
          });
          openChildSessionInAuxPane({
            childSessionId: sessionId,
            parentSessionId,
            workspacePath: session.workspacePath,
            variant: 'btw',
          });
          return;
        }

        if (sessionId === activeSessionId) {
          await openMainSession(sessionId, {
            workspaceId: resolvedWorkspaceId,
            activateWorkspace,
          });
          return;
        }

        await openMainSession(sessionId, {
          workspaceId: resolvedWorkspaceId,
          activateWorkspace,
        });
      } catch (err) {
        log.error('Failed to switch session from capsule', err);
      }
    },
    [activeSessionId, lastUsedWorkspace?.id, openedWorkspacesList, rememberWorkspace]
  );

  const handleOpenTaskDetail = useCallback(() => {
    const state = flowChatStore.getState();
    const targetId =
      state.activeSessionId ??
      Array.from(state.sessions.values())
        .filter(session => session.mode?.toLowerCase() !== 'dispatcher')
        .sort(compareSessionsForDisplay)[0]?.sessionId;
    if (!targetId) return;
    openTaskDetail(targetId);
    openWorkspaceScene('task-detail');
  }, [openTaskDetail]);

  const handleOpenLiveApp = useCallback((appId: string) => {
    openWorkspaceScene(`live-app:${appId}`);
  }, []);

  useEffect(() => {
    const current = new Map<string, { title: string; kind: 'session' | 'live-app' }>();
    const waitingIds = new Set<string>();

    for (const item of runningItems) {
      const id = runningItemId(item);
      if (item.kind === 'live-app') {
        current.set(id, { title: item.app.title, kind: 'live-app' });
        continue;
      }

      const title = getSessionListTitle(item.session);
      const details = getSessionRuntimeDetails(item.session);
      current.set(id, { title, kind: 'session' });
      if (details.isWaiting) waitingIds.add(id);
    }

    const previous = previousRunningItemsRef.current;
    const previousWaiting = previousWaitingIdsRef.current;

    if (!runningSignalsReadyRef.current) {
      previousRunningItemsRef.current = current;
      previousWaitingIdsRef.current = waitingIds;
      runningSignalsReadyRef.current = true;
      return;
    }

    for (const [id, item] of current) {
      if (!previous.has(id)) {
        setCompletedSignal(null);
        setCapsuleSignal({
          id: `${id}:started:${Date.now()}`,
          text: item.kind === 'live-app'
            ? t('nav.sessionCapsule.whisper.appStarted')
            : t('nav.sessionCapsule.whisper.taskStarted'),
          tone: 'working',
        });
        break;
      }
    }

    for (const id of waitingIds) {
      if (!previousWaiting.has(id)) {
        setCapsuleSignal({
          id: `${id}:waiting:${Date.now()}`,
          text: t('nav.sessionCapsule.whisper.needsYou'),
          tone: 'waiting',
        });
        break;
      }
    }

    for (const [id, item] of previous) {
      if (!current.has(id)) {
        setCapsuleSignal(null);
        setCompletedSignal({
          id: `${id}:done:${Date.now()}`,
          text: item.kind === 'live-app'
            ? t('nav.sessionCapsule.whisper.appStopped')
            : t('nav.sessionCapsule.whisper.done'),
          tone: 'done',
          targetId: id.startsWith('session:') ? id.slice('session:'.length) : id.slice('live-app:'.length),
          targetKind: item.kind,
        });
        break;
      }
    }

    previousRunningItemsRef.current = current;
    previousWaitingIdsRef.current = waitingIds;
  }, [getSessionRuntimeDetails, runningItems, t]);

  useEffect(() => {
    if (!capsuleSignal) return;
    const timeout = window.setTimeout(() => setCapsuleSignal(null), capsuleSignal.tone === 'waiting' ? 3600 : 2400);
    return () => window.clearTimeout(timeout);
  }, [capsuleSignal]);

  useEffect(() => {
    if (!completedSignal) return;
    const timeout = window.setTimeout(() => setCompletedSignal(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [completedSignal]);

  const toggle = useCallback(() => {
    setExpanded((v) => {
      const next = !v;
      writeExpandedToStorage(next);
      return next;
    });
  }, []);

  const togglePinned = useCallback(() => {
    setPinned((v) => {
      const next = !v;
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
      `[data-sparo-session-list-result-index="${selectedListResultIndex}"]`
    );
    row?.scrollIntoView({ block: 'nearest' });
  }, [listFilterQuery, listResultCount, selectedListResultIndex]);

  const runningCount = runningItems.length;
  const isSearchingTasks = listFilterQuery.trim().length > 0;
  const showSplitTaskLists = runningCount > 0 && !isSearchingTasks;
  const visibleRunningLiveAppCount = runningSectionExpanded
    ? runningLiveApps.length
    : Math.min(runningLiveApps.length, RUNNING_TASK_COLLAPSED_LIMIT);
  const visibleRunningSessionLimit = runningSectionExpanded
    ? undefined
    : Math.max(0, RUNNING_TASK_COLLAPSED_LIMIT - visibleRunningLiveAppCount);
  const hiddenRunningCount = Math.max(0, runningCount - RUNNING_TASK_COLLAPSED_LIMIT);
  const isSessionSurface =
    activeSurface.kind === 'dispatcher-home' ||
    activeSurface.kind === 'session';
  const showPersistentExpandedPanel = isSessionSurface
    ? (expanded || newSessionDialogOpen)
    : surfaceExpanded;
  const showExpandedPanel = showPersistentExpandedPanel;
  const liftAboveSurface = activeSurface.kind === 'scene';
<<<<<<< HEAD
  const showCollapsedCapsule = isSessionSurface;
  const showRunningCollapsedCapsule = !showExpandedPanel && runningCount > 0;
=======
  const showCollapsedCapsule = isSessionSurface || runningCount > 0;
>>>>>>> 2a535b5 (feat(ppt))

  useEffect(() => {
    if (!showExpandedPanel || newSessionDialogOpen) return;
    window.requestAnimationFrame(() => {
      listSearchInputRef.current?.focus();
    });
  }, [newSessionDialogOpen, showExpandedPanel]);

  const handleOpenCompletedSignal = useCallback(() => {
    if (!completedSignal?.targetId) {
      handleOpenTaskDetail();
      return;
    }
    if (completedSignal.targetKind === 'live-app') {
      handleOpenLiveApp(completedSignal.targetId);
      return;
    }
    void handleSwitchToSession(completedSignal.targetId);
  }, [completedSignal, handleOpenLiveApp, handleOpenTaskDetail, handleSwitchToSession]);

  const collapseCapsule = useCallback(() => {
    if (activeSurface.kind === 'scene') {
      setSurfaceExpanded(false);
      return;
    }
    setExpanded(false);
    writeExpandedToStorage(false);
  }, [activeSurface.kind]);

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
      const row = panelRef.current?.querySelector<HTMLElement>(
        `[data-sparo-session-list-result-index="${selectedListResultIndex}"]`
      );
      row?.click();
    }
  }, [listFilterQuery, listResultCount, selectedListResultIndex]);

  // Collapse when clicking outside the capsule (expanded only).
  // Ignore portaled UI that belongs to the session list (see SessionList).
  useEffect(() => {
    if (!showExpandedPanel || pinned || newSessionDialogOpen) return;
    const handler = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      const root = target instanceof Element ? target : target.parentElement;
      if (root?.closest?.('[data-sparo-ignore-session-capsule-outside]')) return;
      if (root?.closest?.('.modal-overlay')) return;
      collapseCapsule();
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [collapseCapsule, newSessionDialogOpen, pinned, showExpandedPanel]);

  const lastExpandNonceRef = useRef(sessionListExpandNonce);
  useEffect(() => {
    if (sessionListExpandNonce === lastExpandNonceRef.current) return;
    lastExpandNonceRef.current = sessionListExpandNonce;
    if (activeSurface.kind === 'scene') {
      setSurfaceExpanded(true);
      return;
    }
    setExpanded(true);
    writeExpandedToStorage(true);
  }, [activeSurface.kind, sessionListExpandNonce]);

  return (
    !showExpandedPanel && !showCollapsedCapsule && !showRunningCollapsedCapsule ? null : (
    <div
      ref={panelRef}
      className={[
        'session-capsule',
        showExpandedPanel ? 'session-capsule--expanded' : '',
        showRunningCollapsedCapsule ? 'session-capsule--running' : '',
        liftAboveSurface ? 'session-capsule--above-scene-chrome' : '',
      ].filter(Boolean).join(' ')}
      aria-label={t('nav.sections.sessions')}
    >
      {showExpandedPanel ? (
        <>
          {/* Header: search + pin */}
          <div className="session-capsule__title-bar">
            <Search
              ref={listSearchInputRef}
              className="session-capsule__search-input session-capsule__search--pill"
              placeholder={t('nav.sessionCapsule.searchPlaceholder')}
              value={listFilterQuery}
              onChange={setListFilterQuery}
              onClear={() => setListFilterQuery('')}
              onKeyDown={handleListSearchKeyDown}
              clearable
              size="small"
              enterToSearch={false}
              inputAriaLabel={t('nav.sessionCapsule.searchPlaceholder')}
            />
            <div className="session-capsule__title-actions">
              <IconButton
                size="xs"
                variant="ghost"
                className={`session-capsule__icon-action${pinned ? ' is-pinned' : ''}`}
                onClick={togglePinned}
                aria-label={pinned ? t('nav.sessionCapsule.unpinKeepOpen') : t('nav.sessionCapsule.pinKeepOpen')}
                aria-pressed={pinned}
                tooltip={pinned ? t('nav.sessionCapsule.unpinKeepOpen') : t('nav.sessionCapsule.pinKeepOpen')}
                tooltipPlacement="top"
              >
                <Pin size={12} strokeWidth={2.25} fill={pinned ? 'currentColor' : 'none'} />
              </IconButton>
            </div>
          </div>

          {/* Task list */}
          <div className="session-capsule__list">
            {showSplitTaskLists ? (
              <>
                <section className="session-capsule__section" aria-label={t('nav.sessionCapsule.runningSessionsGroupLabel')}>
                  <div className="session-capsule__section-header">
                    <span>{t('nav.sessionCapsule.runningSessionsGroupLabel')}</span>
                    {hiddenRunningCount > 0 ? (
                      <Button
                        size="small"
                        variant="ghost"
                        className="session-capsule__section-toggle"
                        onClick={() => setRunningSectionExpanded((value) => !value)}
                        aria-expanded={runningSectionExpanded}
                      >
                        {runningSectionExpanded ? (
                          <ChevronUp size={12} strokeWidth={2.25} aria-hidden />
                        ) : (
                          <ChevronDown size={12} strokeWidth={2.25} aria-hidden />
                        )}
                        <span>
                          {runningSectionExpanded
                            ? t('nav.sessions.showLess')
                            : t('nav.sessions.showAll', { count: hiddenRunningCount })}
                        </span>
                      </Button>
                    ) : null}
                  </div>
                  <SessionList
                    listAllSessions
                    maxSessions={visibleRunningSessionLimit}
                    maxRunningLiveApps={visibleRunningLiveAppCount}
                    runningFilter="running"
                    showGroupLabels={false}
                    selectedResultIndex={-1}
                  />
                </section>

                <section className="session-capsule__section session-capsule__section--recent" aria-label={t('nav.search.groupRecentTasks')}>
                  <div className="session-capsule__section-header">
                    <span>{t('nav.search.groupRecentTasks')}</span>
                  </div>
                  <SessionList
                    listAllSessions
                    maxSessions={RECENT_SESSION_LIMIT}
                    runningFilter="not-running"
                    showRunningLiveApps={false}
                    showGroupLabels={false}
                    selectedResultIndex={-1}
                  />
                </section>
              </>
            ) : (
              <SessionList
                listAllSessions
                listFilterQuery={listFilterQuery}
                maxSessions={RECENT_SESSION_LIMIT}
                selectedResultIndex={isSearchingTasks ? selectedListResultIndex : -1}
                onResultCountChange={setListResultCount}
              />
            )}
          </div>

          {/* Footer: new session + task center */}
          <div className="session-capsule__footer">
            <Button
              size="small"
              variant="ghost"
              className="session-capsule__new-task-action"
              onClick={() => setNewSessionDialogOpen(true)}
              aria-label={t('nav.sessionCapsule.newSessionButton')}
            >
              <Plus size={13} strokeWidth={2.25} />
              <span>{t('nav.sessionCapsule.newSessionButton')}</span>
            </Button>
            <IconButton
              size="xs"
              variant="ghost"
              className="session-capsule__icon-action"
              aria-label={t('nav.sessionCapsule.openTaskCenter')}
              onClick={handleOpenTaskDetail}
              tooltip={t('nav.sessionCapsule.openTaskCenter')}
              tooltipPlacement="top"
            >
              <LayoutDashboard size={13} strokeWidth={2.25} />
            </IconButton>
          </div>
          <NewSessionDialog open={newSessionDialogOpen} onClose={() => setNewSessionDialogOpen(false)} />
        </>
      ) : showRunningCollapsedCapsule ? (
        <>
          {completedSignal && (
            <Button
              key={completedSignal.id}
              variant="ghost"
              size="small"
              className="session-capsule__whisper session-capsule__whisper--done session-capsule__whisper--button"
              onClick={handleOpenCompletedSignal}
            >
              <CheckCircle2 size={12} strokeWidth={2.2} aria-hidden />
              <span>{completedSignal.text}</span>
            </Button>
          )}
          <div className="session-capsule__running-panel">
            <div className="session-capsule__running-hd">
              <span className="session-capsule__running-hd-label">{t('nav.sessionCapsule.runningSessionsGroupLabel')}</span>
              <span className="session-capsule__running-count">{runningCount}</span>
            </div>
            <div className="session-capsule__running-rows">
              {runningItems.map((item) => {
                if (item.kind === 'live-app') {
                  return (
                    <div key={item.app.id} className="session-capsule__running-row-wrap">
                      <button
                        type="button"
                        className="session-capsule__running-row"
                        onClick={() => handleOpenLiveApp(item.app.id)}
                        aria-label={item.app.title}
                        style={{ '--session-capsule-tone': 'var(--ds-color-success)' } as React.CSSProperties}
                      >
                        <div className="session-capsule__mode-avatar is-live-app">
                          {renderLiveAppIcon(item.app.icon, 11)}
                        </div>
                        <div className="session-capsule__running-row-copy">
                          <span className="session-capsule__running-row-title">{item.app.title}</span>
                          <span className="session-capsule__running-row-status">
                            <StatusDot tone="success" size="small" pulse />
                            <span>{t('nav.sessionCapsule.liveAppBadge')}</span>
                          </span>
                        </div>
                      </button>
                    </div>
                  );
                }
                const details = getSessionRuntimeDetails(item.session);
                const toneColor = toneToColor[details.tone];
                const ModeIcon = getSessionModeIcon(item.session);
                const isActive = item.session.sessionId === activeSessionId;
                return (
                  <div key={item.session.sessionId} className="session-capsule__running-row-wrap">
                    <button
                      type="button"
                      className={`session-capsule__running-row${isActive ? ' is-active' : ''}`}
                      onClick={() => void handleSwitchToSession(item.session.sessionId)}
                      aria-label={getSessionListTitle(item.session)}
                      style={{ '--session-capsule-tone': toneColor } as React.CSSProperties}
                    >
                      <div
                        className={`session-capsule__mode-avatar${isActive ? ' is-focused' : ''}`}
                        style={{ '--session-capsule-tone': toneColor } as React.CSSProperties}
                      >
                        <ModeIcon size={11} />
                      </div>
                      <div className="session-capsule__running-row-copy">
                        <span className="session-capsule__running-row-title">{getSessionListTitle(item.session)}</span>
                        <span className="session-capsule__running-row-status">
                          <StatusDot
                            tone={details.tone === 'waiting' ? 'warning' : 'info'}
                            size="small"
                            pulse
                          />
                          <span>{details.label}</span>
                        </span>
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="session-capsule__running-ft">
              <div className="session-capsule__running-actions">
                <button
                  type="button"
                  className="session-capsule__open-list-action session-capsule__open-list-action--full"
                  onClick={toggle}
                  aria-label={t('actions.more')}
                >
                  <ChevronDown size={12} />
                  <span>{t('actions.more')}</span>
                </button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          {completedSignal && (
            <Button
              key={completedSignal.id}
              variant="ghost"
              size="small"
              className="session-capsule__whisper session-capsule__whisper--done session-capsule__whisper--button"
              onClick={handleOpenCompletedSignal}
            >
              <CheckCircle2 size={12} strokeWidth={2.2} aria-hidden />
              <span>{completedSignal.text}</span>
            </Button>
          )}
          <IconButton
            size="small"
            variant="ghost"
            className="session-capsule__trigger"
            onClick={toggle}
            aria-label={t('nav.sections.sessions')}
            aria-expanded={false}
            tooltip={t('nav.sections.sessions')}
            tooltipPlacement="right"
          >
            <ListChecks size={15} />
          </IconButton>
        </>
      )}
    </div>
    )
  );
};

export default SessionCapsule;
