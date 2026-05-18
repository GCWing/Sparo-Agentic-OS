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
import { Brush, CheckCircle2, Code2, ListChecks, LayoutDashboard, LayoutGrid, ListTodo, Pin, Plus, Sparkles, Square } from 'lucide-react';
import { Badge, Button, IconButton, Search, StatusDot, Tooltip } from '@/design-system';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import { flowChatStore } from '../../../flow_chat/store/FlowChatStore';
import type { FlowChatState, Session } from '../../../flow_chat/types/flow-chat';
import { stateMachineManager } from '../../../flow_chat/state-machine';
import { ProcessingPhase, SessionExecutionState } from '../../../flow_chat/state-machine/types';
import {
  openChildSessionInAuxPane,
  openMainSession,
  selectActiveChildSessionTab,
} from '../../../flow_chat/services/childSessionPanels';
import { resolveSessionRelationship } from '../../../flow_chat/utils/sessionMetadata';
import { compareSessionsForDisplay, findOpenedWorkspaceForSession } from '../../../flow_chat/utils/sessionOrdering';
import { useAgentCanvasStore } from '@/app/components/panels/content-canvas/stores';
import { createLogger } from '@/shared/utils/logger';
import { LiveAppGlyph } from '@/app/scenes/apps/live-app/liveAppIcons';
import { renderLiveAppIcon } from '@/app/scenes/apps/live-app/liveAppIconHelpers';
import {
  resolveActiveRunningLiveAppId,
  useRunningLiveAppItems,
  type RunningLiveAppItem,
} from '@/app/scenes/apps/live-app/liveAppTaskView';
import { openWorkspaceHome, openWorkspaceScene } from '../../navigation/workspaceNavigation';
import { useWorkspaceSurfaceStore } from '../../navigation/workspaceSurfaceStore';
import { flowChatManager } from '@/flow_chat/services/FlowChatManager';
import { liveAppAPI } from '@/infrastructure/api/service-api/LiveAppAPI';
import { useLiveAppStore } from '@/app/scenes/apps/live-app/liveAppStore';
import { useSessionCapsuleStore } from '../../stores/sessionCapsuleStore';
import SessionList from '../SessionList/SessionList';
import { NewSessionDialog } from './NewSessionDialog';
import './SessionCapsule.scss';

const log = createLogger('SessionCapsule');
const AGENT_SCENE = 'session' as const;
/** Default visible rows in the expanded capsule; search still filters within this slice. */
const RECENT_SESSION_LIMIT = 7;

type SessionMode = 'code' | 'cowork' | 'design' | 'deepresearch' | 'liveappstudio';
type CapsuleTone = 'working' | 'waiting' | 'finishing';
type CapsuleBadgeVariant = 'success' | 'warning' | 'accent';
type CapsuleStatusTone = 'success' | 'warning' | 'accent';

interface CapsuleSignal {
  id: string;
  text: string;
  tone: CapsuleTone | 'done';
  targetId?: string;
  targetKind?: 'session' | 'live-app';
}

const resolveSessionModeType = (session: Session): SessionMode => {
  const normalizedMode = session.mode?.toLowerCase();
  if (normalizedMode === 'cowork') return 'cowork';
  if (normalizedMode === 'design') return 'design';
  if (normalizedMode === 'deepresearch') return 'deepresearch';
  if (normalizedMode === 'liveappstudio') return 'liveappstudio';
  return 'code';
};

const getSessionListTitle = (session: Session): string =>
  session.title?.trim() || `Task ${session.sessionId.slice(0, 6)}`;

function runningItemId(item: { kind: 'session'; session: Session } | { kind: 'live-app'; app: RunningLiveAppItem }): string {
  return item.kind === 'live-app' ? `live-app:${item.app.id}` : `session:${item.session.sessionId}`;
}

const getCapsuleBadgeVariant = (tone: CapsuleTone): CapsuleBadgeVariant => {
  if (tone === 'waiting') return 'warning';
  if (tone === 'finishing') return 'accent';
  return 'success';
};

const getCapsuleStatusTone = (tone: CapsuleTone): CapsuleStatusTone => {
  if (tone === 'waiting') return 'warning';
  if (tone === 'finishing') return 'accent';
  return 'success';
};

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
  const activeSceneId = activeSurface.kind === 'scene' ? activeSurface.sceneId : null;
  const markWorkerStopped = useLiveAppStore((s) => s.markWorkerStopped);
  const openTaskDetail = useSessionCapsuleStore((s) => s.openTaskDetail);
  const sessionListExpandNonce = useSessionCapsuleStore((s) => s.sessionListExpandNonce);
  const { openedWorkspacesList, rememberWorkspace, lastUsedWorkspace } = useWorkspaceContext();
  const activeChildSessionTab = useAgentCanvasStore(
    state => selectActiveChildSessionTab(state as any)
  );
  const activeChildSessionData = activeChildSessionTab?.content.data as
    | { childSessionId: string; parentSessionId: string; workspacePath?: string }
    | undefined;

  const [expanded, setExpanded] = useState<boolean>(readExpandedFromStorage);
  const [pinned, setPinned] = useState<boolean>(readPinnedFromStorage);
  const [surfaceExpanded, setSurfaceExpanded] = useState(false);
  const [listFilterQuery, setListFilterQuery] = useState('');
  const [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false);
  const [flowChatState, setFlowChatState] = useState<FlowChatState>(() => flowChatStore.getState());
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const [capsuleSignal, setCapsuleSignal] = useState<CapsuleSignal | null>(null);
  const [completedSignal, setCompletedSignal] = useState<CapsuleSignal | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previousRunningItemsRef = useRef<Map<string, { title: string; kind: 'session' | 'live-app' }>>(new Map());
  const previousWaitingIdsRef = useRef<Set<string>>(new Set());
  const runningSignalsReadyRef = useRef(false);
  const runningLiveApps = useRunningLiveAppItems();
  const activeLiveAppId = resolveActiveRunningLiveAppId(activeSceneId);

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
  const activeTabId = activeSurface.kind === 'scene' ? activeSurface.sceneId : AGENT_SCENE;

  const isSessionUiFocused = useCallback(
    (session: Session | undefined): boolean => {
      if (!session) return false;
      const relationship = resolveSessionRelationship(session);
      if (relationship.canOpenInAuxPane) {
        return activeChildSessionData?.childSessionId === session.sessionId;
      }
      return activeTabId === AGENT_SCENE && session.sessionId === activeSessionId;
    },
    [activeChildSessionData?.childSessionId, activeSessionId, activeTabId]
  );

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

  const getLiveAppRuntimeDetails = useCallback(
    (): { label: string; tone: CapsuleTone; isWaiting: boolean } => ({
      label: t('nav.sessionCapsule.status.runningApp'),
      tone: 'working',
      isWaiting: false,
    }),
    [t]
  );

  const capsuleTone = useMemo<CapsuleTone>(() => {
    let hasFinishing = false;
    for (const item of runningItems) {
      if (item.kind === 'live-app') continue;
      const details = getSessionRuntimeDetails(item.session);
      if (details.isWaiting) return 'waiting';
      if (details.tone === 'finishing') hasFinishing = true;
    }
    return hasFinishing ? 'finishing' : 'working';
  }, [getSessionRuntimeDetails, runningItems]);

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

  const handleOpenTaskList = useCallback(() => {
    setExpanded(true);
    writeExpandedToStorage(true);
  }, []);

  const handleOpenLiveApp = useCallback((appId: string) => {
    openWorkspaceScene(`live-app:${appId}`);
  }, []);

  const handleCancelSessionTask = useCallback((event: React.MouseEvent, sessionId: string) => {
    event.stopPropagation();
    void flowChatManager.cancelTaskForSession(sessionId);
  }, []);

  const handleStopLiveApp = useCallback(
    async (event: React.MouseEvent, appId: string) => {
      event.stopPropagation();
      try {
        await liveAppAPI.workerStop(appId);
      } catch (error) {
        log.warn('Failed to stop live app worker', { appId, error });
      } finally {
        markWorkerStopped(appId);
        if (activeSceneId === `live-app:${appId}`) {
          void openWorkspaceHome();
        }
      }
    },
    [activeSceneId, markWorkerStopped]
  );

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

  const runningCount = runningItems.length;
  const isSessionSurface =
    activeSurface.kind === 'dispatcher-home' ||
    activeSurface.kind === 'session';
  const showPersistentExpandedPanel = isSessionSurface
    ? (expanded || newSessionDialogOpen)
    : surfaceExpanded;
  const showExpandedPanel = showPersistentExpandedPanel;
  const liftAboveSurface = activeSurface.kind === 'scene';
  const showCollapsedCapsule = isSessionSurface;

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
    !showExpandedPanel && !showCollapsedCapsule ? null : (
    <div
      ref={panelRef}
      className={[
        'session-capsule',
        showPersistentExpandedPanel ? 'session-capsule--expanded' : '',
        !showExpandedPanel && runningCount > 0 ? 'session-capsule--running' : '',
        !showExpandedPanel && runningCount > 0 ? `session-capsule--tone-${capsuleTone}` : '',
        liftAboveSurface ? 'session-capsule--above-scene-chrome' : '',
      ].filter(Boolean).join(' ')}
      aria-label={t('nav.sections.sessions')}
    >
      {showExpandedPanel ? (
        <>
          {/* Title bar: label + count + pin + collapse */}
          <div className="session-capsule__title-bar">
            <span className="session-capsule__title-label">{t('nav.sections.sessions')}</span>
            <div className="session-capsule__title-actions">
              <IconButton
                size="xs"
                variant={pinned ? 'primary' : 'ghost'}
                className={`session-capsule__icon-action${pinned ? ' is-pinned' : ''}`}
                onClick={togglePinned}
                aria-label={pinned ? t('nav.sessionCapsule.unpinKeepOpen') : t('nav.sessionCapsule.pinKeepOpen')}
                aria-pressed={pinned}
                tooltip={pinned ? t('nav.sessionCapsule.unpinKeepOpen') : t('nav.sessionCapsule.pinKeepOpen')}
                tooltipPlacement="top"
              >
                <Pin size={12} strokeWidth={2.25} />
              </IconButton>
            </div>
          </div>

          {/* Search row */}
          <div className="session-capsule__header">
            <Search
              className="session-capsule__search-input session-capsule__search--pill"
              placeholder={t('nav.sessionCapsule.searchPlaceholder')}
              value={listFilterQuery}
              onChange={setListFilterQuery}
              onClear={() => setListFilterQuery('')}
              clearable
              size="small"
              enterToSearch={false}
              inputAriaLabel={t('nav.sessionCapsule.searchPlaceholder')}
            />
          </div>

          {/* Task list */}
          <div className="session-capsule__list">
            <SessionList
              listAllSessions
              listFilterQuery={listFilterQuery}
              maxSessions={RECENT_SESSION_LIMIT}
            />
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
      ) : runningItems.length > 0 ? (
        <>
          {capsuleSignal && (
            <div
              key={capsuleSignal.id}
              className={`session-capsule__whisper session-capsule__whisper--${capsuleSignal.tone}`}
              role="status"
            >
              {capsuleSignal.text}
            </div>
          )}
          <div
            className="session-capsule__running-panel"
            role="group"
            aria-label={t('nav.sessionCapsule.runningSessionsGroupLabel')}
          >
            <div className="session-capsule__running-hd">
              <span className="session-capsule__running-hd-label">
                {capsuleTone === 'waiting'
                  ? t('nav.sessionCapsule.status.waitingShort')
                  : capsuleTone === 'finishing'
                    ? t('nav.sessionCapsule.status.finishingShort')
                    : t('nav.sessionCapsule.runningSessionsGroupLabel')}
              </span>
              <Badge
                variant={getCapsuleBadgeVariant(capsuleTone)}
                className="session-capsule__running-count"
              >
                {runningItems.length}
              </Badge>
            </div>

            <div className="session-capsule__running-rows">
            {runningItems.map(item => {
              if (item.kind === 'live-app') {
                const { app } = item;
                const focused = activeLiveAppId === app.id;
                const details = getLiveAppRuntimeDetails();
                return (
                  <div key={app.id} className="session-capsule__running-row-wrap">
                    <Tooltip
                      content={t('nav.sessionCapsule.runningLiveAppTooltip', { title: app.title })}
                      placement="right"
                    >
                      <Button
                        variant="ghost"
                        size="small"
                        className={`session-capsule__running-row${focused ? ' is-active' : ''}`}
                        onClick={() => handleOpenLiveApp(app.id)}
                        aria-label={t('nav.sessionCapsule.runningLiveAppTooltip', { title: app.title })}
                      >
                        <span
                          className={[
                            'session-capsule__mode-avatar',
                            'is-live-app',
                            focused ? 'is-focused' : '',
                          ].filter(Boolean).join(' ')}
                          aria-hidden
                        >
                          {renderLiveAppIcon(app.icon, 12)}
                        </span>
                        <span className="session-capsule__running-row-copy">
                          <span className="session-capsule__running-row-title">{app.title}</span>
                          <span className="session-capsule__running-row-status">
                            <StatusDot
                              tone={getCapsuleStatusTone(details.tone)}
                              size="small"
                              pulse
                            />
                            <span>{details.label}</span>
                          </span>
                        </span>
                        <Badge variant="info" className="session-capsule__running-row-badge">
                          <LayoutGrid size={10} aria-hidden />
                        </Badge>
                      </Button>
                    </Tooltip>
                    <IconButton
                      size="xs"
                      variant="ghost"
                      className="session-capsule__running-row-cancel"
                      onClick={event => void handleStopLiveApp(event, app.id)}
                      aria-label={t('nav.sessionCapsule.stopRunningLiveApp')}
                      tooltip={t('nav.sessionCapsule.stopRunningLiveApp')}
                      tooltipPlacement="right"
                    >
                      <Square className="session-capsule__running-row-cancel-icon" size={10} strokeWidth={2.25} aria-hidden />
                    </IconButton>
                  </div>
                );
              }

              const { session } = item;
              const mode = resolveSessionModeType(session);
              const ModeIcon =
                mode === 'cowork'
                  ? ListTodo
                  : mode === 'design'
                    ? Brush
                    : mode === 'deepresearch' || mode === 'liveappstudio'
                      ? Sparkles
                      : Code2;
              const focused = isSessionUiFocused(session);
              const title = getSessionListTitle(session);
              const details = getSessionRuntimeDetails(session);
              return (
                <div key={session.sessionId} className="session-capsule__running-row-wrap">
                  <Tooltip
                    content={t('nav.sessionCapsule.runningSwitchTooltip', { title })}
                    placement="right"
                  >
                    <Button
                      variant="ghost"
                      size="small"
                      className={`session-capsule__running-row${focused ? ' is-active' : ''}`}
                      onClick={() => void handleSwitchToSession(session.sessionId)}
                      aria-label={t('nav.sessionCapsule.runningSwitchTooltip', { title })}
                    >
                      <span
                        className={[
                          'session-capsule__mode-avatar',
                          `is-${mode}`,
                          focused ? 'is-focused' : '',
                        ].filter(Boolean).join(' ')}
                        aria-hidden
                      >
                        {mode === 'liveappstudio' ? (
                          <LiveAppGlyph size={12} strokeWidth={1.8} />
                        ) : (
                          <ModeIcon size={12} strokeWidth={2.4} />
                        )}
                      </span>
                      <span className="session-capsule__running-row-copy">
                        <span className="session-capsule__running-row-title">{title}</span>
                        <span className="session-capsule__running-row-status">
                          <StatusDot
                            tone={getCapsuleStatusTone(details.tone)}
                            size="small"
                            pulse={details.tone === 'working'}
                          />
                          <span>{details.label}</span>
                        </span>
                      </span>
                    </Button>
                  </Tooltip>
                  <IconButton
                    size="xs"
                    variant="ghost"
                    className="session-capsule__running-row-cancel"
                    onClick={event => handleCancelSessionTask(event, session.sessionId)}
                    aria-label={t('nav.sessionCapsule.cancelRunningAgentTask')}
                    tooltip={t('nav.sessionCapsule.cancelRunningAgentTask')}
                    tooltipPlacement="right"
                  >
                    <Square className="session-capsule__running-row-cancel-icon" size={10} strokeWidth={2.25} aria-hidden />
                  </IconButton>
                </div>
              );
            })}
            </div>
            <div className="session-capsule__running-ft">
              <div className="session-capsule__running-actions">
                <Tooltip content={t('nav.sessionCapsule.openTaskList')} placement="right">
                  <Button
                    variant="ghost"
                    size="small"
                    className="session-capsule__open-list-action"
                    onClick={handleOpenTaskList}
                    aria-label={t('nav.sessionCapsule.openTaskList')}
                  >
                    <ListChecks size={11} strokeWidth={2.3} aria-hidden />
                    <span>{t('nav.sessionCapsule.taskListShort')}</span>
                  </Button>
                </Tooltip>
                <Tooltip content={t('nav.sessionCapsule.openTaskCenter')} placement="right">
                  <Button
                    variant="ghost"
                    size="small"
                    className="session-capsule__open-list-action session-capsule__open-list-action--center"
                    onClick={handleOpenTaskDetail}
                    aria-label={t('nav.sessionCapsule.openTaskCenter')}
                  >
                    <LayoutDashboard size={11} strokeWidth={2.3} aria-hidden />
                    <span>{t('nav.sessionCapsule.taskCenterShort')}</span>
                  </Button>
                </Tooltip>
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
