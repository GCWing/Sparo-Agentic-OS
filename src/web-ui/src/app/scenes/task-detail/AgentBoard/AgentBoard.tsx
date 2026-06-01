/**
 * AgentBoard — right-side kanban board for the Task Center.
 *
 * Shows a BoardHeader + scrollable list of AgentGroups.
 * Handles grouping by agent (default), status, or time.
 */

import React, { useCallback, useMemo } from 'react';
import { Layers } from 'lucide-react';
import { useI18n } from '@/infrastructure/i18n';
import { flowChatManager } from '@/flow_chat/services/FlowChatManager';
import { openMainSession } from '@/flow_chat/services/childSessionPanels';
import { agentAPI } from '@/infrastructure/api';
import { liveAppAPI } from '@/infrastructure/api/service-api/LiveAppAPI';
import { useLiveAppStore } from '@/app/scenes/apps/live-app/liveAppStore';
import { useSessionCapsuleStore } from '@/app/stores/sessionCapsuleStore';
import { openWorkspaceHome, openWorkspaceScene } from '@/app/navigation/workspaceNavigation';
import { useWorkspaceSurfaceStore } from '@/app/navigation/workspaceSurfaceStore';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import { createLogger } from '@/shared/utils/logger';
import { type AgentKind } from '../taskCenter/agentKinds';
import { getBackendAgentType } from '@/flow_chat/domain/sessionDescriptor';
import type { ScopedTasksResult, TaskItem, SessionTaskItem } from '../taskCenter/useScopedTasks';
import type { TaskCenterScope, TaskCenterGrouping, TaskCenterView } from '@/app/stores/sessionCapsuleStore';
import BoardHeader from './BoardHeader';
import AgentGroup from './AgentGroup';
import TaskCard from './TaskCard';
import './AgentBoard.scss';

const log = createLogger('AgentBoard');

// ── Status / time grouping helpers ────────────────────────────────────────────

type StatusGroup = 'running' | 'active' | 'idle' | 'error';
const STATUS_ORDER: StatusGroup[] = ['running', 'active', 'error', 'idle'];
const STATUS_LABELS: Record<StatusGroup, string> = {
  running: 'Running',
  active: 'Active',
  idle: 'Idle',
  error: 'Error',
};

type TimeGroup = 'today' | 'thisWeek' | 'earlier';
const TIME_ORDER: TimeGroup[] = ['today', 'thisWeek', 'earlier'];

function getTimeGroup(ts: number): TimeGroup {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 86_400_000) return 'today';
  if (diff < 7 * 86_400_000) return 'thisWeek';
  return 'earlier';
}

// ── AgentBoard ────────────────────────────────────────────────────────────────

interface AgentBoardProps {
  scope: TaskCenterScope;
  scopeName: string;
  scopePath?: string;
  tasksResult: ScopedTasksResult;
  searchQuery: string;
  grouping: TaskCenterGrouping;
  view: TaskCenterView;
  collapsedGroups: string[];
  onSearchChange: (q: string) => void;
  onGroupingChange: (g: TaskCenterGrouping) => void;
  onViewChange: (v: TaskCenterView) => void;
  onToggleGroupCollapsed: (key: string) => void;
  onNewSession?: (kind: AgentKind) => void;
  workspaces: import('@/shared/types').WorkspaceInfo[];
}

const AgentBoard: React.FC<AgentBoardProps> = ({
  scope,
  scopeName,
  scopePath,
  tasksResult,
  searchQuery,
  grouping,
  view,
  collapsedGroups,
  onSearchChange,
  onGroupingChange,
  onViewChange,
  onToggleGroupCollapsed,
  onNewSession,
  workspaces,
}) => {
  const { t, formatDate } = useI18n('scenes/task-detail');
  const closeTaskDetail = useSessionCapsuleStore((s) => s.closeTaskDetail);
  const activeSurface = useWorkspaceSurfaceStore((s) => s.activeSurface);
  const markWorkerStopped = useLiveAppStore((s) => s.markWorkerStopped);
  const closeLiveAppInStore = useLiveAppStore((s) => s.closeApp);
  const { switchWorkspace, openedWorkspacesList } = useWorkspaceContext();

  const openedWorkspaceIdSet = useMemo(
    () => new Set(openedWorkspacesList.map((ws) => ws.id)),
    [openedWorkspacesList]
  );

  const formatRelativeTime = useCallback(
    (ts: number) => {
      const diff = Date.now() - ts;
      if (diff < 60_000) return t('relativeJustNow');
      if (diff < 3_600_000)
        return t('relativeMinutesAgo', { count: Math.floor(diff / 60_000) });
      if (diff < 86_400_000)
        return t('relativeHoursAgo', { count: Math.floor(diff / 3_600_000) });
      if (diff < 7 * 86_400_000)
        return t('relativeDaysAgo', { count: Math.floor(diff / 86_400_000) });
      return formatDate(new Date(ts), { month: 'short', day: 'numeric' });
    },
    [t, formatDate]
  );

  const handleOpen = useCallback(
    async (item: TaskItem) => {
      try {
        if (item.source === 'liveApp') {
          openWorkspaceScene(`live-app:${item.id}`);
          closeTaskDetail();
          return;
        }
        const session = (item as SessionTaskItem).payload;
        const wsId = item.workspaceId;
        const ws = wsId ? workspaces.find((w) => w.id === wsId) : undefined;
        if (ws && !openedWorkspaceIdSet.has(ws.id)) {
          await switchWorkspace(ws);
        }
        await openMainSession(session.sessionId, {
          workspaceId: wsId,
        });
        closeTaskDetail();
      } catch (e) {
        log.error('Failed to open task item', e);
      }
    },
    [
      workspaces,
      openedWorkspaceIdSet,
      switchWorkspace,
      closeTaskDetail,
    ]
  );

  const handleStop = useCallback(async (item: TaskItem) => {
    try {
      if (item.source === 'liveApp') {
        const overlayId = `live-app:${item.id}`;
        await liveAppAPI.workerStop(item.id);
        markWorkerStopped(item.id);
        closeLiveAppInStore(item.id);
        if (activeSurface.kind === 'scene' && activeSurface.sceneId === overlayId) void openWorkspaceHome();
        return;
      }
      // For sessions, signal cancellation via stateMachineManager if available
      // (cancellation not uniformly available; log a warn if missing)
      log.warn('Stop not yet implemented for session tasks', { id: item.id });
    } catch (e) {
      log.error('Failed to stop task', e);
    }
  }, [activeSurface, closeLiveAppInStore, markWorkerStopped]);

  const handleDelete = useCallback(async (item: TaskItem) => {
    try {
      if (item.source === 'session') {
        await flowChatManager.deleteChatSession(item.id);
      }
    } catch (e) {
      log.error('Failed to delete task', e);
    }
  }, []);

  const handleQuickSend = useCallback(
    async (item: SessionTaskItem, message: string) => {
      const session = item.payload;
      const { sessionId, workspacePath, storageScope } = session;
      const agentType = getBackendAgentType(session.descriptor);
      try {
        // Ensure backend coordinator session exists without switching UI to this session
        await agentAPI.ensureCoordinatorSession({
          sessionId,
          workspacePath: workspacePath ?? undefined,
          storageScope,
        });
        await agentAPI.startDialogTurn({
          sessionId,
          userInput: message,
          agentType,
          workspacePath: workspacePath ?? undefined,
        });
      } catch (e) {
        log.error('Failed to quick-send message', { sessionId, error: e });
      }
    },
    []
  );

  // ── Display groups (agent / status / time) ──────────────────────────────────

  const displayGroups = useMemo(() => {
    if (grouping === 'agent') {
      return tasksResult.groups.map((g) => ({
        key: g.kind,
        label: t(`agent.${g.kind}.label`),
        kind: g.kind as AgentKind | undefined,
        items: g.items,
      }));
    }

    if (grouping === 'status') {
      const map = new Map<StatusGroup, TaskItem[]>();
      for (const item of tasksResult.all) {
        const sg = item.status as StatusGroup;
        const bucket = map.get(sg);
        if (bucket) bucket.push(item);
        else map.set(sg, [item]);
      }
      return STATUS_ORDER.filter((sg) => map.has(sg)).map((sg) => ({
        key: sg,
        label: STATUS_LABELS[sg],
        kind: undefined as AgentKind | undefined,
        items: map.get(sg)!,
      }));
    }

    // time grouping
    const map = new Map<TimeGroup, TaskItem[]>();
    for (const item of tasksResult.all) {
      const tg = getTimeGroup(item.updatedAt);
      const bucket = map.get(tg);
      if (bucket) bucket.push(item);
      else map.set(tg, [item]);
    }
    return TIME_ORDER.filter((tg) => map.has(tg)).map((tg) => ({
      key: tg,
      label: t(`board.timeGroup.${tg}`),
      kind: undefined as AgentKind | undefined,
      items: map.get(tg)!,
    }));
  }, [grouping, tasksResult, t]);

  // Show workspace label on cards when not scoped to a single workspace row.
  const showWorkspace = scope.kind === 'system' || scope.kind === 'running' || workspaces.length > 1;

  const handleToggle = useCallback(
    (key: string) => {
      onToggleGroupCollapsed(key);
    },
    [onToggleGroupCollapsed]
  );

  const isEmpty = tasksResult.totalCount === 0;

  return (
    <div className="ab-board">
      <BoardHeader
        scope={scope}
        scopeName={scopeName}
        scopePath={scopePath}
        runningCount={tasksResult.runningCount}
        totalCount={tasksResult.totalCount}
        searchQuery={searchQuery}
        grouping={grouping}
        view={view}
        onSearchChange={onSearchChange}
        onGroupingChange={onGroupingChange}
        onViewChange={onViewChange}
      />

      <div className={`ab-board__scroll${view === 'rows' ? ' ab-board__scroll--rows' : ''}`}>
        {isEmpty ? (
          <div className="ab-board__empty">
            <Layers size={36} />
            <p>{t('emptyWorkspaceSessions')}</p>
          </div>
        ) : (
          <div className="ab-board__groups">
            {displayGroups.map((group) =>
              grouping === 'agent' && group.kind ? (
                <AgentGroup
                  key={group.key}
                  kind={group.kind}
                  items={group.items}
                  isCollapsed={collapsedGroups.includes(group.key)}
                  viewMode={view}
                  highlightedId={null}
                  showWorkspace={showWorkspace}
                  onToggleCollapse={() => handleToggle(group.key)}
                  onNewSession={onNewSession}
                  formatRelativeTime={formatRelativeTime}
                  onOpen={handleOpen}
                  onStop={handleStop}
                  onDelete={handleDelete}
                  onQuickSend={handleQuickSend}
                />
              ) : (
                <div key={group.key} className="ab-simple-group">
                  <div className="ab-simple-group__head">
                    <span className="ab-simple-group__title">{group.label}</span>
                    <span className="ab-simple-group__count">{group.items.length}</span>
                  </div>
                  <div className={`ab-simple-group__body ab-simple-group__body--${view}`}>
                    {group.items.map((item) => (
                      <TaskCard
                        key={item.id}
                        item={item}
                        isHighlighted={false}
                        showWorkspace={showWorkspace}
                        viewMode={view}
                        formatRelativeTime={formatRelativeTime}
                        onOpen={handleOpen}
                        onStop={handleStop}
                        onDelete={handleDelete}
                        onQuickSend={handleQuickSend}
                      />
                    ))}
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentBoard;
