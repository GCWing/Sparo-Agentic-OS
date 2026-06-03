/**
 * SessionList �?reusable session list for the new workspace layout.
 *
 * Used by the floating `SessionCapsule`, profile pages, and
 * workspace-scoped lists inside scene navigation.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, Trash2, Check, X, Brush, Code2, ListTodo, Sparkles, MoreHorizontal, LayoutGrid, Square } from 'lucide-react';
import { Badge, DotMatrixLoader, EmptyState, IconButton, Input, StatusDot, Tooltip } from '@/design-system';
import { useI18n } from '@/infrastructure/i18n';
import { flowChatStore } from '../../../flow_chat/store/FlowChatStore';
import { flowChatManager } from '../../../flow_chat/services/FlowChatManager';
import type { FlowChatState, Session } from '../../../flow_chat/types/flow-chat';
import { openWorkspaceHome, openWorkspaceScene } from '../../navigation/workspaceNavigation';
import { useWorkspaceSurfaceStore } from '../../navigation/workspaceSurfaceStore';
import { getWorkspaceDisplayName, useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import { createLogger } from '@/shared/utils/logger';
import { useMovingHoverHighlight } from '@/shared/hooks/useMovingHoverHighlight';
import { useAgentCanvasStore } from '@/app/components/panels/content-canvas/stores';
import {
  openChildSessionInAuxPane,
  openMainSession,
  selectActiveChildSessionTab,
} from '@/flow_chat/services/childSessionPanels';
import { resolveSessionRelationship } from '@/flow_chat/utils/sessionMetadata';
import {
  compareSessionsForDisplay,
  findOpenedWorkspaceForSession,
  sessionBelongsToWorkspaceNavRow,
} from '@/flow_chat/utils/sessionOrdering';
import {
  resolveActiveRunningLiveAppId,
  useRunningLiveAppItems,
  type RunningLiveAppItem,
} from '@/app/scenes/apps/live-app/liveAppTaskView';
import { LiveAppGlyph } from '@/app/scenes/apps/live-app/liveAppIcons';
import { renderLiveAppIcon } from '@/app/scenes/apps/live-app/liveAppIconHelpers';
import { liveAppAPI } from '@/infrastructure/api/service-api/LiveAppAPI';
import { useLiveAppStore } from '@/app/scenes/apps/live-app/liveAppStore';
import { stateMachineManager } from '@/flow_chat/state-machine';
import { SessionExecutionState } from '@/flow_chat/state-machine/types';
import { getSessionNavigationSignature } from '@/flow_chat/utils/sessionNavigationSignature';
import { isSystemAgenticOsSession } from '@/flow_chat/domain/sessionDescriptor';
import './SessionList.scss';

const log = createLogger('SessionList');
const AGENT_SCENE = 'session' as const;

type SessionMode = 'code' | 'cowork' | 'design' | 'deepresearch' | 'liveappstudio';

const resolveSessionModeType = (session: Session): SessionMode => {
  if (session.descriptor.profileId === 'cowork') return 'cowork';
  if (session.descriptor.profileId === 'design') return 'design';
  if (session.descriptor.profileId === 'deep-research') return 'deepresearch';
  if (session.descriptor.profileId === 'live-app-studio') return 'liveappstudio';
  return 'code';
};

const getSessionTitle = (session: Session): string =>
  session.title?.trim() || `Task ${session.sessionId.slice(0, 6)}`;

export interface SessionListProps {
  workspaceId?: string;
  workspacePath?: string;
  isActiveWorkspace?: boolean;
  showCreateActions?: boolean;
  contextLabel?: string;
  showSessionModeIcon?: boolean;
  listAllSessions?: boolean;
  listFilterQuery?: string;
  maxSessions?: number;
  maxRunningLiveApps?: number;
  runningFilter?: 'all' | 'running' | 'not-running';
  showRunningLiveApps?: boolean;
  showGroupLabels?: boolean;
  selectedResultIndex?: number;
  onResultCountChange?: (count: number) => void;
}

const SessionList: React.FC<SessionListProps> = ({
  workspaceId,
  workspacePath,
  isActiveWorkspace: _isActiveWorkspace = true,
  contextLabel,
  showSessionModeIcon = true,
  listAllSessions = false,
  listFilterQuery,
  maxSessions,
  maxRunningLiveApps,
  runningFilter = 'all',
  showRunningLiveApps = true,
  showGroupLabels = true,
  selectedResultIndex = -1,
  onResultCountChange,
}) => {
  const { t } = useI18n('common');
  const { rememberWorkspace, lastUsedWorkspace, openedWorkspacesList } = useWorkspaceContext();
  const activeSurface = useWorkspaceSurfaceStore(s => s.activeSurface);
  const activeSceneId = activeSurface.kind === 'scene' ? activeSurface.sceneId : null;
  const markWorkerStopped = useLiveAppStore(s => s.markWorkerStopped);
  const activeTabId = activeSceneId ?? AGENT_SCENE;
  const activeLiveAppId = resolveActiveRunningLiveAppId(activeSceneId);
  const runningLiveApps = useRunningLiveAppItems();
  const activeChildSessionTab = useAgentCanvasStore(
    state => selectActiveChildSessionTab(state as any)
  );
  const activeChildSessionData = activeChildSessionTab?.content.data as
    | { childSessionId: string; parentSessionId: string; workspacePath?: string }
    | undefined;
  const [flowChatState, setFlowChatState] = useState<FlowChatState>(() =>
    flowChatStore.getState()
  );
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [openMenuSessionId, setOpenMenuSessionId] = useState<string | null>(null);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(new Set());
  const editInputRef = useRef<HTMLInputElement>(null);
  const itemHover = useMovingHoverHighlight<HTMLDivElement>();

  useEffect(() => {
    const updateRunningSessions = () => {
      const running = new Set<string>();
      for (const session of flowChatState.sessions.values()) {
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
    };

    updateRunningSessions();
    const unsubscribe = stateMachineManager.subscribeGlobal(() => {
      updateRunningSessions();
    });
    return () => unsubscribe();
  }, [flowChatState.sessions]);

  useEffect(() => {
    const unsubscribe = flowChatStore.subscribeSelector(
      getSessionNavigationSignature,
      (_signature, nextState) => setFlowChatState(nextState),
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (editingSessionId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingSessionId]);

  useEffect(() => {
    if (!openMenuSessionId) return;
    const handleOutside = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('[data-sparo-session-list-inline-actions]')) {
        setOpenMenuSessionId(null);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [openMenuSessionId]);

  const sessions = useMemo(
    () =>
      Array.from(flowChatState.sessions.values())
        .filter((session: Session) => {
          if (isSystemAgenticOsSession(session.descriptor)) return false;
          const isRunning = runningSessionIds.has(session.sessionId);
          if (runningFilter === 'running' && !isRunning) return false;
          if (runningFilter === 'not-running' && isRunning) return false;
          if (listAllSessions) return true;
          if (workspacePath) {
            return sessionBelongsToWorkspaceNavRow(session, workspacePath);
          }
          return !session.workspacePath;
        })
        .sort(compareSessionsForDisplay),
    [flowChatState.sessions, workspacePath, listAllSessions, runningFilter, runningSessionIds]
  );

  const { topLevelSessions, childrenByParent } = useMemo(() => {
    const childMap = new Map<string, Session[]>();
    const parents: Session[] = [];
    const knownIds = new Set(sessions.map(session => session.sessionId));

    for (const session of sessions) {
      const parentSessionId = resolveSessionRelationship(session).parentSessionId;
      if (parentSessionId && parentSessionId.trim() && knownIds.has(parentSessionId)) {
        const children = childMap.get(parentSessionId) || [];
        children.push(session);
        childMap.set(parentSessionId, children);
      } else {
        parents.push(session);
      }
    }

    for (const [parentSessionId, children] of childMap) {
      childMap.set(parentSessionId, [...children].sort(compareSessionsForDisplay));
    }

    return {
      topLevelSessions: [...parents].sort(compareSessionsForDisplay),
      childrenByParent: childMap,
    };
  }, [sessions]);

  const visibleItems = useMemo(() => {
    const items: Array<{ session: Session; level: 0 | 1 }> = [];
    for (const parentSession of topLevelSessions) {
      items.push({ session: parentSession, level: 0 });
      const childSessions = childrenByParent.get(parentSession.sessionId) || [];
      for (const childSession of childSessions) {
        items.push({ session: childSession, level: 1 });
      }
    }
    return items;
  }, [childrenByParent, topLevelSessions]);

  const filteredVisibleItems = useMemo(() => {
    const trimmedQuery = listFilterQuery?.trim();
    if (!trimmedQuery) return visibleItems.slice(0, maxSessions ?? Number.POSITIVE_INFINITY);

    const normalizedQuery = trimmedQuery.toLowerCase();
    return visibleItems.filter(({ session }) => {
      if (getSessionTitle(session).toLowerCase().includes(normalizedQuery)) return true;
      if (session.sessionId.toLowerCase().includes(normalizedQuery)) return true;
      if (listAllSessions) {
        const workspace = findOpenedWorkspaceForSession(session, openedWorkspacesList);
        if (workspace?.name?.toLowerCase().includes(normalizedQuery)) return true;
        if (workspace && getWorkspaceDisplayName(workspace).toLowerCase().includes(normalizedQuery)) return true;
      }
      return false;
    });
  }, [visibleItems, listFilterQuery, listAllSessions, openedWorkspacesList, maxSessions]);

  const filteredRunningLiveApps = useMemo(() => {
    if (!showRunningLiveApps) return [];
    const trimmedQuery = listFilterQuery?.trim().toLowerCase();
    const filtered = trimmedQuery
      ? runningLiveApps.filter(app =>
      app.title.toLowerCase().includes(trimmedQuery) ||
      app.id.toLowerCase().includes(trimmedQuery) ||
      app.description.toLowerCase().includes(trimmedQuery)
      )
      : runningLiveApps;
    return filtered.slice(0, maxRunningLiveApps ?? Number.POSITIVE_INFINITY);
  }, [listFilterQuery, maxRunningLiveApps, runningLiveApps, showRunningLiveApps]);

  useEffect(() => {
    onResultCountChange?.(filteredRunningLiveApps.length + filteredVisibleItems.length);
  }, [filteredRunningLiveApps.length, filteredVisibleItems.length, onResultCountChange]);

  const activeSessionId = flowChatState.activeSessionId;

  const handleSwitch = useCallback(
    async (sessionId: string) => {
      if (editingSessionId) return;
      try {
        const session = flowChatStore.getState().sessions.get(sessionId);
        const relationship = resolveSessionRelationship(session);
        const parentSessionId = relationship.parentSessionId;
        const resolvedWorkspaceId =
          listAllSessions && session
            ? findOpenedWorkspaceForSession(session, openedWorkspacesList)?.id
            : workspaceId;
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
        setOpenMenuSessionId(null);
      } catch (error) {
        log.error('Failed to switch session', error);
      }
    },
    [
      activeSessionId,
      lastUsedWorkspace?.id,
      editingSessionId,
      listAllSessions,
      openedWorkspacesList,
      rememberWorkspace,
      workspaceId,
    ]
  );

  const resolveDisplayTitle = useCallback(
    (session: Session): string => {
      const rawTitle = getSessionTitle(session);
      const matched = rawTitle.match(/^(?:新建会话|New Session)\s*(\d+)$/i);
      if (!matched) return rawTitle;

      const mode = resolveSessionModeType(session);
      const label =
        mode === 'cowork'
          ? t('nav.sessions.newCoworkSession')
          : mode === 'design'
            ? t('nav.sessions.newDesignSession')
          : mode === 'deepresearch'
            ? t('nav.sessions.newDeepResearchSession')
            : mode === 'liveappstudio'
              ? t('nav.sessions.modeLiveAppStudio')
            : t('nav.sessions.newCodeSession');
      return `${label} ${matched[1]}`;
    },
    [t]
  );

  const handleMenuOpen = useCallback(
    (event: React.MouseEvent, sessionId: string) => {
      event.stopPropagation();
      if (openMenuSessionId === sessionId) {
        setOpenMenuSessionId(null);
        return;
      }
      setOpenMenuSessionId(sessionId);
    },
    [openMenuSessionId]
  );

  const handleDelete = useCallback(
    async (event: React.MouseEvent, sessionId: string) => {
      event.stopPropagation();
      try {
        await flowChatManager.deleteChatSession(sessionId);
        setOpenMenuSessionId(null);
      } catch (error) {
        log.error('Failed to delete session', error);
      }
    },
    []
  );

  const handleCancelSessionTask = useCallback(
    (event: React.MouseEvent, sessionId: string) => {
      event.stopPropagation();
      void flowChatManager.cancelTaskForSession(sessionId);
    },
    []
  );

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

  const handleStartEdit = useCallback(
    (event: React.MouseEvent, session: Session) => {
      event.stopPropagation();
      setOpenMenuSessionId(null);
      setEditingSessionId(session.sessionId);
      setEditingTitle(resolveDisplayTitle(session));
    },
    [resolveDisplayTitle]
  );

  const handleConfirmEdit = useCallback(async () => {
    if (!editingSessionId) return;
    const trimmedTitle = editingTitle.trim();
    if (trimmedTitle) {
      try {
        await flowChatManager.renameChatSessionTitle(editingSessionId, trimmedTitle);
      } catch (error) {
        log.error('Failed to update session title', error);
      }
    }
    setEditingSessionId(null);
    setEditingTitle('');
  }, [editingSessionId, editingTitle]);

  const handleCancelEdit = useCallback(() => {
    setEditingSessionId(null);
    setEditingTitle('');
  }, []);

  const handleEditKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleConfirmEdit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        handleCancelEdit();
      }
    },
    [handleConfirmEdit, handleCancelEdit]
  );

  if (topLevelSessions.length === 0 && runningLiveApps.length === 0) {
    return null;
  }

  if (filteredVisibleItems.length === 0 && filteredRunningLiveApps.length === 0 && listFilterQuery?.trim()) {
    return (
      <div className="sparo-session-list__list sparo-session-list__list--filter-empty">
        <EmptyState
          className="sparo-session-list__filter-empty"
          image={<span aria-hidden />}
          imageSize="small"
          description={t('nav.sessionCapsule.filterNoMatch')}
        />
      </div>
    );
  }

  return (
    <div
      ref={itemHover.surfaceRef}
      className="sparo-session-list__list sparo-session-list__list--motion"
      {...itemHover.getSurfaceHandlers('.sparo-session-list__item')}
    >
      <div
        className={`sparo-session-list__hover-highlight ${itemHover.highlight.visible ? 'sparo-session-list__hover-highlight--visible' : ''}`}
        style={{
          '--sparo-session-list-hover-top': `${itemHover.highlight.top}px`,
          '--sparo-session-list-hover-left': `${itemHover.highlight.left}px`,
          '--sparo-session-list-hover-width': `${itemHover.highlight.width}px`,
          '--sparo-session-list-hover-height': `${itemHover.highlight.height}px`,
          '--sparo-session-list-hover-stretch-x': itemHover.highlight.stretchX,
          '--sparo-session-list-hover-stretch-y': itemHover.highlight.stretchY,
        } as React.CSSProperties}
        aria-hidden
      />
      {filteredRunningLiveApps.length > 0 ? (
        <>
          {showGroupLabels ? (
            <div className="sparo-session-list__group-label">
              {t('nav.sessionCapsule.runningLiveAppsGroupLabel')}
            </div>
          ) : null}
          {filteredRunningLiveApps.map((app: RunningLiveAppItem, index) => {
            const isRowActive = activeTabId === app.overlayId || activeLiveAppId === app.id;
            const resultIndex = index;
            const row = (
              <div
                key={app.id}
                className={[
                  'sparo-session-list__item',
                  'is-live-app',
                  isRowActive && 'is-active',
                  resultIndex === selectedResultIndex && 'is-keyboard-active',
                ].filter(Boolean).join(' ')}
                onClick={() => openWorkspaceScene(app.overlayId)}
                {...itemHover.getItemHandlers()}
                data-sparo-session-list-result-index={resultIndex}
                aria-selected={resultIndex === selectedResultIndex}
              >
                <span className="sparo-session-list__item-icon is-live-app">
                  {renderLiveAppIcon(app.icon, 14)}
                </span>
                <span className="sparo-session-list__item-main">
                  <span className="sparo-session-list__item-label">{app.title}</span>
                  <Badge variant="success" className="sparo-session-list__item-live-badge">
                    <StatusDot tone="success" size="small" pulse />
                    <LayoutGrid size={10} aria-hidden />
                    {t('nav.sessionCapsule.liveAppBadge')}
                  </Badge>
                </span>
                <div className="sparo-session-list__item-trailing">
                  <IconButton
                    variant="ghost"
                    size="xs"
                    className="sparo-session-list__item-cancel-action"
                    onClick={event => void handleStopLiveApp(event, app.id)}
                    tooltip={t('nav.sessionCapsule.stopRunningLiveApp')}
                    tooltipPlacement="top"
                    aria-label={t('nav.sessionCapsule.stopRunningLiveApp')}
                  >
                    <Square className="sparo-session-list__item-cancel-icon" size={11} strokeWidth={2.25} aria-hidden />
                  </IconButton>
                </div>
              </div>
            );
            return (
              <Tooltip key={app.id} content={app.description || app.title} placement="right" followCursor>
                {row}
              </Tooltip>
            );
          })}
        </>
      ) : null}

      {showGroupLabels && filteredRunningLiveApps.length > 0 && filteredVisibleItems.length > 0 ? (
        <div className="sparo-session-list__group-label is-secondary">
          {t('nav.search.groupSessions')}
        </div>
      ) : null}

      {filteredVisibleItems.map(({ session, level }, index) => {
        const resultIndex = filteredRunningLiveApps.length + index;
        const isEditing = editingSessionId === session.sessionId;
        const relationship = resolveSessionRelationship(session);
        const isChildAuxSession = level === 1 && relationship.canOpenInAuxPane;
        const sessionModeKey = resolveSessionModeType(session);
        const sessionTitle = resolveDisplayTitle(session);
        const parentSessionId = relationship.parentSessionId;
        const parentSession = parentSessionId ? flowChatState.sessions.get(parentSessionId) : undefined;
        const parentTitle = parentSession ? resolveDisplayTitle(parentSession) : '';
        const parentTurnIndex = relationship.origin?.parentTurnIndex;
        const rowWorkspace = listAllSessions
          ? findOpenedWorkspaceForSession(session, openedWorkspacesList)
          : undefined;
        const rowContextLabel = listAllSessions
          ? (rowWorkspace ? getWorkspaceDisplayName(rowWorkspace) : '')
          : (contextLabel?.trim() ?? '');
        const showContextInTooltip = rowContextLabel.length > 0;
        const showRichTooltip = showContextInTooltip || isChildAuxSession;
        const tooltipContent = showRichTooltip ? (
          <div className="sparo-session-list__item-tooltip">
            <div className="sparo-session-list__item-tooltip-title">{sessionTitle}</div>
            {showContextInTooltip ? (
              <div className="sparo-session-list__item-tooltip-meta">
                {listAllSessions
                  ? t('nav.sessions.sessionContext', { name: rowContextLabel })
                  : t('nav.sessions.workspaceOwner', { name: rowContextLabel })}
              </div>
            ) : null}
            {isChildAuxSession ? (
              <div className="sparo-session-list__item-tooltip-meta">
                {`From ${parentTitle || 'parent session'}${parentTurnIndex ? ` · turn ${parentTurnIndex}` : ''}`}
              </div>
            ) : null}
          </div>
        ) : (
          sessionTitle
        );
        const SessionIcon =
          sessionModeKey === 'cowork'
            ? ListTodo
            : sessionModeKey === 'design'
              ? Brush
            : sessionModeKey === 'deepresearch' || sessionModeKey === 'liveappstudio'
              ? Sparkles
              : Code2;
        const isRunning = runningSessionIds.has(session.sessionId);
        const isRowActive = activeChildSessionData?.childSessionId
          ? session.sessionId === activeChildSessionData.childSessionId
          : activeTabId === AGENT_SCENE && session.sessionId === activeSessionId;
        const row = (
          <div
            key={session.sessionId}
            className={[
              'sparo-session-list__item',
              level === 1 && 'is-child',
              isChildAuxSession && 'is-aux-child',
              isRowActive && 'is-active',
              resultIndex === selectedResultIndex && 'is-keyboard-active',
              isEditing && 'is-editing',
              openMenuSessionId === session.sessionId && 'is-menu-open',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => handleSwitch(session.sessionId)}
            {...itemHover.getItemHandlers()}
            data-sparo-session-list-result-index={resultIndex}
            aria-selected={resultIndex === selectedResultIndex}
          >
            {showSessionModeIcon && !isChildAuxSession ? (
              isRunning ? (
                <DotMatrixLoader size="tiny" className="sparo-session-list__running-dots" />
              ) : (
                sessionModeKey === 'liveappstudio' ? (
                  <LiveAppGlyph
                    size={14}
                    strokeWidth={1.7}
                    className={[
                      'sparo-session-list__item-icon',
                      'is-liveappstudio',
                    ].join(' ')}
                  />
                ) : (
                  <SessionIcon
                    size={14}
                    className={[
                      'sparo-session-list__item-icon',
                      sessionModeKey === 'cowork'
                        ? 'is-cowork'
                        : sessionModeKey === 'design'
                          ? 'is-design'
                        : sessionModeKey === 'deepresearch'
                          ? 'is-deepresearch'
                          : 'is-code',
                    ].join(' ')}
                  />
                )
              )
            ) : null}

            {isEditing ? (
              <div className="sparo-session-list__item-edit" onClick={event => event.stopPropagation()}>
                <Input
                  ref={editInputRef}
                  className="sparo-session-list__item-edit-field"
                  variant="default"
                  inputSize="small"
                  value={editingTitle}
                  onChange={event => setEditingTitle(event.target.value)}
                  onKeyDown={handleEditKeyDown}
                  onBlur={handleConfirmEdit}
                />
                <IconButton
                  variant="success"
                  size="xs"
                  className="sparo-session-list__item-edit-action"
                  onClick={event => {
                    event.stopPropagation();
                    handleConfirmEdit();
                  }}
                  tooltip={t('nav.sessions.confirmEdit')}
                  tooltipPlacement="top"
                >
                  <Check size={11} />
                </IconButton>
                <IconButton
                  variant="default"
                  size="xs"
                  className="sparo-session-list__item-edit-action"
                  onMouseDown={event => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleCancelEdit();
                  }}
                  tooltip={t('nav.sessions.cancelEdit')}
                  tooltipPlacement="top"
                >
                  <X size={11} />
                </IconButton>
              </div>
            ) : (
              <>
                <span className="sparo-session-list__item-main">
                  <span className="sparo-session-list__item-label">{sessionTitle}</span>
                  {isChildAuxSession ? (
                    <Badge variant="neutral" className="sparo-session-list__item-session-kind-badge">
                      btw
                    </Badge>
                  ) : null}
                </span>
                <div className="sparo-session-list__item-trailing">
                  {isRunning ? (
                    <IconButton
                      variant="ghost"
                      size="xs"
                      className="sparo-session-list__item-cancel-action sparo-session-list__item-cancel-action--always-visible"
                      onClick={event => handleCancelSessionTask(event, session.sessionId)}
                      tooltip={t('nav.sessionCapsule.cancelRunningAgentTask')}
                      tooltipPlacement="top"
                      aria-label={t('nav.sessionCapsule.cancelRunningAgentTask')}
                    >
                      <Square className="sparo-session-list__item-cancel-icon" size={11} strokeWidth={2.25} aria-hidden />
                    </IconButton>
                  ) : (
                    <div
                      className={[
                        'sparo-session-list__item-actions',
                        openMenuSessionId === session.sessionId && 'is-expanded',
                      ].filter(Boolean).join(' ')}
                      data-sparo-session-list-inline-actions
                    >
                      {openMenuSessionId === session.sessionId ? (
                        <>
                          <IconButton
                            type="button"
                            size="xs"
                            variant="ghost"
                            className="sparo-session-list__item-inline-action is-rename"
                            onClick={event => handleStartEdit(event, session)}
                            tooltip={t('nav.sessions.rename')}
                            tooltipPlacement="top"
                            aria-label={t('nav.sessions.rename')}
                          >
                            <Pencil size={12} strokeWidth={1.55} aria-hidden />
                          </IconButton>
                          <IconButton
                            type="button"
                            size="xs"
                            variant="danger"
                            className="sparo-session-list__item-inline-action is-delete"
                            onClick={event => void handleDelete(event, session.sessionId)}
                            tooltip={t('nav.sessions.delete')}
                            tooltipPlacement="top"
                            aria-label={t('nav.sessions.delete')}
                          >
                            <Trash2 size={12} strokeWidth={1.55} aria-hidden />
                          </IconButton>
                        </>
                      ) : (
                        <IconButton
                          type="button"
                          size="xs"
                          variant="ghost"
                          className="sparo-session-list__item-menu-action"
                          onClick={event => handleMenuOpen(event, session.sessionId)}
                          tooltip={t('actions.more')}
                          aria-label={t('actions.more')}
                          aria-expanded={false}
                        >
                          <MoreHorizontal size={12} strokeWidth={1.55} aria-hidden />
                        </IconButton>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        );
        return isEditing || openMenuSessionId !== null ? row : (
          <Tooltip key={session.sessionId} content={tooltipContent} placement="right" followCursor>
            {row}
          </Tooltip>
        );
      })}
    </div>
  );
};

export default SessionList;
