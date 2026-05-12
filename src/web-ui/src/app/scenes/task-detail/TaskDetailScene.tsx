/**
 * TaskDetailScene — Task Center shell.
 *
 * Two-column layout:
 *   - Left (~240px): ScopeRail — system + workspace scope selector
 *   - Right (flex 1): AgentBoard — per-scope task kanban
 *
 * All heavy logic is delegated to:
 *   - useScopedTasks (data layer)
 *   - ScopeRail (left nav)
 *   - AgentBoard (right board)
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import { flowChatManager } from '@/flow_chat/services/FlowChatManager';
import { useSessionCapsuleStore } from '../../stores/sessionCapsuleStore';
import { useI18n } from '@/infrastructure/i18n';
import { createLogger } from '@/shared/utils/logger';
import { launchSessionForChoice } from '@/app/components/SessionCapsule/NewSessionDialog';
import { useScopedTasks } from './taskCenter/useScopedTasks';
import { type AgentKind } from './taskCenter/agentKinds';
import { filterUserWorkspaces } from './taskCenter/workspaceFilters';
import { resolveProfile } from '@/app/session-profiles';
import ScopeRail from './ScopeRail/ScopeRail';
import AgentBoard from './AgentBoard/AgentBoard';
import './TaskDetailScene.scss';

const log = createLogger('TaskDetailScene');
const RECENT_WS_LIMIT = 7;

const TaskDetailScene: React.FC = () => {
  const { t } = useI18n('common');
  const scope = useSessionCapsuleStore((s) => s.taskCenterScope);
  const setTaskCenterScope = useSessionCapsuleStore((s) => s.setTaskCenterScope);
  const taskCenterGrouping = useSessionCapsuleStore((s) => s.taskCenterGrouping);
  const setTaskCenterGrouping = useSessionCapsuleStore((s) => s.setTaskCenterGrouping);
  const taskCenterView = useSessionCapsuleStore((s) => s.taskCenterView);
  const setTaskCenterView = useSessionCapsuleStore((s) => s.setTaskCenterView);
  const taskCenterCollapsedGroups = useSessionCapsuleStore((s) => s.taskCenterCollapsedGroups);
  const toggleTaskCenterGroupCollapsed = useSessionCapsuleStore((s) => s.toggleTaskCenterGroupCollapsed);

  const [boardSearch, setBoardSearch] = React.useState('');

  const {
    openedWorkspacesList,
    recentWorkspaces,
    rememberWorkspace,
  } = useWorkspaceContext();

  // ── Default scope on open ──────────────────────────────────────────────────

  // ── Workspace list for data layer ──────────────────────────────────────────

  const allWorkspaces = useMemo(() => {
    const map = new Map(openedWorkspacesList.map((ws) => [ws.id, ws]));
    recentWorkspaces.slice(0, RECENT_WS_LIMIT).forEach((ws) => {
      if (!map.has(ws.id)) map.set(ws.id, ws);
    });
    return filterUserWorkspaces(Array.from(map.values()));
  }, [openedWorkspacesList, recentWorkspaces]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    let gBuffer = false;
    let gTimer: ReturnType<typeof setTimeout> | null = null;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isEditable =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      // '/' — focus board search
      if (e.key === '/' && !isEditable) {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>('.ab-board .search__input');
        input?.focus();
        return;
      }

      // 'g' prefix sequences: g+s = system scope, g+w = first workspace
      if (e.key === 'g' && !isEditable) {
        gBuffer = true;
        if (gTimer) clearTimeout(gTimer);
        gTimer = setTimeout(() => { gBuffer = false; }, 600);
        return;
      }

      if (gBuffer) {
        gBuffer = false;
        if (gTimer) { clearTimeout(gTimer); gTimer = null; }
        if (e.key === 's') {
          e.preventDefault();
          setTaskCenterScope({ kind: 'system' });
          return;
        }
        if (e.key === 'w') {
          e.preventDefault();
          if (allWorkspaces.length === 1) {
            setTaskCenterScope({ kind: 'workspace', id: allWorkspaces[0].id });
          }
          return;
        }
      }
    };

    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      if (gTimer) clearTimeout(gTimer);
    };
  }, [allWorkspaces, openedWorkspacesList, setTaskCenterScope]);

  // ── Data: scoped tasks ─────────────────────────────────────────────────────

  const tasksResult = useScopedTasks(scope, allWorkspaces, boardSearch);
  /** Recent-run scope rail badge + data layer (no board search filter on rail counts). */
  const recentRunRailResult = useScopedTasks({ kind: 'running' }, allWorkspaces, '');

  // ── Per-workspace task counts for rail badges ──────────────────────────────

  const { workspaceTaskCounts, workspaceRunningCounts } = useMemo(() => {
    const taskCounts = new Map<string, number>();
    const runningCounts = new Map<string, number>();

    // Compute across all workspace scopes (not filtered by current scope)
    const allScopedForRail = allWorkspaces.map((ws) => ({
      wsId: ws.id,
      // We pass a placeholder search to get unfiltered counts
    }));

    // For simplicity, use the already-computed groups only for the current scope,
    // and for other workspaces count from flowChatStore directly.
    // This avoids calling useScopedTasks N times. The rail badge is informational.
    // tasksResult already holds data for current scope; for other scopes we
    // approximate by using the all-sessions approach.
    for (const ws of allScopedForRail) {
      taskCounts.set(ws.wsId, 0);
      runningCounts.set(ws.wsId, 0);
    }

    // Fill from tasksResult for the currently selected workspace scope
    if (scope.kind === 'workspace') {
      taskCounts.set(scope.id, tasksResult.totalCount);
      runningCounts.set(scope.id, tasksResult.runningCount);
    }

    return { workspaceTaskCounts: taskCounts, workspaceRunningCounts: runningCounts };
  }, [allWorkspaces, scope, tasksResult]);

  // ── System running count ───────────────────────────────────────────────────

  const systemRunningCount = scope.kind === 'system' ? tasksResult.runningCount : 0;

  // ── Scope metadata for BoardHeader ────────────────────────────────────────

  const scopeName = useMemo(() => {
    if (scope.kind === 'running') return t('taskDetailScene.scope.running.title');
    if (scope.kind === 'system') return t('taskDetailScene.board.breadcrumb.system');
    const ws = allWorkspaces.find((w) => w.id === scope.id);
    return ws?.name || scope.id;
  }, [scope, allWorkspaces, t]);

  const scopePath = useMemo(() => {
    if (scope.kind === 'running' || scope.kind === 'system') return undefined;
    const ws = allWorkspaces.find((w) => w.id === scope.id);
    return ws?.rootPath;
  }, [scope, allWorkspaces]);

  // ── New session handler ────────────────────────────────────────────────────

  const handleNewSession = useCallback(
    async (kind: AgentKind) => {
      try {
        if (kind === 'liveAppStudio') {
          await launchSessionForChoice({
            agentChoice: 'LiveAppStudio',
            workspace: null,
            rememberWorkspace,
          });
          return;
        }
        if (kind === 'agentAppStudio') {
          await launchSessionForChoice({
            agentChoice: 'AgentAppStudio',
            workspace: null,
            rememberWorkspace,
          });
          return;
        }
        const modeMap: Partial<Record<AgentKind, string>> = {
          code: 'code',
          cowork: 'cowork',
          design: 'design',
          deepResearch: 'deepresearch',
          liveApp: 'liveapp',
        };
        const mode = modeMap[kind];
        if (!mode) return;
        const profile = resolveProfile(mode);
        void profile;
        await flowChatManager.createChatSession({}, mode);
      } catch (e) {
        log.error('Failed to create new session from task center', { kind, error: e });
      }
    },
    [rememberWorkspace]
  );

  const handleToggleGroup = useCallback(
    (key: string) => {
      toggleTaskCenterGroupCollapsed(key);
    },
    [toggleTaskCenterGroupCollapsed]
  );

  return (
    <div className="tds">
      <div className="tds-layout tds-layout--v2">
        {/* ── Left: Scope Rail ───────────────────────────────────────── */}
        <ScopeRail
          scope={scope}
          onScopeChange={setTaskCenterScope}
          workspaceTaskCounts={workspaceTaskCounts}
          workspaceRunningCounts={workspaceRunningCounts}
          systemRunningCount={systemRunningCount}
          recentRunRunningCount={recentRunRailResult.runningCount}
        />

        {/* ── Right: Agent Board ─────────────────────────────────────── */}
        <AgentBoard
          scope={scope}
          scopeName={scopeName}
          scopePath={scopePath}
          tasksResult={tasksResult}
          searchQuery={boardSearch}
          grouping={taskCenterGrouping}
          view={taskCenterView}
          collapsedGroups={taskCenterCollapsedGroups}
          onSearchChange={setBoardSearch}
          onGroupingChange={setTaskCenterGrouping}
          onViewChange={setTaskCenterView}
          onToggleGroupCollapsed={handleToggleGroup}
          onNewSession={handleNewSession}
          workspaces={allWorkspaces}
        />
      </div>
    </div>
  );
};

export default TaskDetailScene;
