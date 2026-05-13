/**
 * useScopedTasks — unified task data layer for the Task Center.
 *
 * Given the current TaskCenterScope, merges:
 *   - flowChatStore sessions (dispatcher hidden in UI; deepResearch / code / cowork / design / other)
 *   - Live App running items (via useRunningLiveAppItems)
 *   - execution state from stateMachineManager (running vs idle for sessions)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import { stateMachineManager } from '@/flow_chat/state-machine';
import { SessionExecutionState } from '@/flow_chat/state-machine/types';
import type { FlowChatState, Session } from '@/flow_chat/types/flow-chat';
import type { WorkspaceInfo } from '@/shared/types';
import { findWorkspaceForSession } from '@/flow_chat/utils/workspaceScope';
import { compareSessionsForDisplay } from '@/flow_chat/utils/sessionOrdering';
import { useRunningLiveAppItems, type RunningLiveAppItem } from '@/app/scenes/apps/live-app/liveAppTaskView';
import { type AgentKind, resolveAgentKind, SYSTEM_GROUP_ORDER, WORKSPACE_GROUP_ORDER } from './agentKinds';
import type { TaskCenterScope } from '@/app/stores/sessionCapsuleStore';

// ── Status variant ────────────────────────────────────────────────────────────

export type StatusVariant = 'running' | 'active' | 'error' | 'idle';

function getSessionStatus(session: Session, runningIds: Set<string>): StatusVariant {
  if (runningIds.has(session.sessionId)) return 'running';
  if (session.status === 'error') return 'error';
  return 'idle';
}

// ── TaskItem ──────────────────────────────────────────────────────────────────

export type TaskItemSource = 'session' | 'liveApp';

export interface SessionTaskItem {
  id: string;
  kind: AgentKind;
  source: 'session';
  status: StatusVariant;
  title: string;
  workspaceId?: string;
  workspaceName?: string;
  updatedAt: number;
  payload: Session;
}

export interface LiveAppTaskItem {
  id: string;
  kind: 'liveApp';
  source: 'liveApp';
  status: StatusVariant;
  title: string;
  workspaceId?: undefined;
  workspaceName?: undefined;
  updatedAt: number;
  payload: RunningLiveAppItem;
}

export type TaskItem = SessionTaskItem | LiveAppTaskItem;

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface ScopedTasksResult {
  /** Grouped tasks in display order. */
  groups: Array<{ kind: AgentKind; items: TaskItem[] }>;
  /** Flat list for search/filter. */
  all: TaskItem[];
  /** Count of currently running items. */
  runningCount: number;
  /** Total item count. */
  totalCount: number;
}

export function useScopedTasks(
  scope: TaskCenterScope,
  workspaces: WorkspaceInfo[],
  searchQuery: string
): ScopedTasksResult {
  const [flowState, setFlowState] = useState<FlowChatState>(() => flowChatStore.getState());
  // Use a plain string array so reference changes only happen when content changes.
  const [runningIdList, setRunningIdList] = useState<string[]>([]);

  const runningLiveApps = useRunningLiveAppItems();

  useEffect(() => {
    setFlowState(flowChatStore.getState());
    return flowChatStore.subscribe((s) => setFlowState(s));
  }, []);

  // Re-compute running IDs independently of flowState to avoid circular dependency.
  useEffect(() => {
    const compute = () => {
      const running: string[] = [];
      for (const s of flowChatStore.getState().sessions.values()) {
        const m = stateMachineManager.get(s.sessionId);
        if (
          m &&
          (m.getCurrentState() === SessionExecutionState.PROCESSING ||
            m.getCurrentState() === SessionExecutionState.FINISHING)
        ) {
          running.push(s.sessionId);
        }
      }
      setRunningIdList((prev) => {
        // Only update if contents changed (avoid unnecessary re-renders)
        if (prev.length === running.length && prev.every((id, i) => id === running[i])) return prev;
        return running;
      });
    };
    compute();
    return stateMachineManager.subscribeGlobal(compute);
  }, []);

  const runningIds = useMemo(() => new Set(runningIdList), [runningIdList]);

  const normalizeQuery = useCallback((q: string) => q.trim().toLowerCase(), []);
  const qNorm = useMemo(() => normalizeQuery(searchQuery), [normalizeQuery, searchQuery]);

  const matchesQuery = useCallback(
    (haystack: string) => !qNorm || haystack.toLowerCase().includes(qNorm),
    [qNorm]
  );

  const allItems = useMemo<TaskItem[]>(() => {
    const items: TaskItem[] = [];

    // Live App items (running workers only, system / running scope)
    if (scope.kind === 'system' || scope.kind === 'running') {
      for (const app of runningLiveApps) {
        if (!matchesQuery(app.title)) continue;
        items.push({
          id: app.id,
          kind: 'liveApp',
          source: 'liveApp',
          status: 'running',
          title: app.title,
          updatedAt: app.updatedAt,
          payload: app,
        });
      }
    }

    // Session items
    const sessions = Array.from(flowState.sessions.values()).sort(compareSessionsForDisplay);

    for (const session of sessions) {
      const kind = resolveAgentKind(session);
      const status = getSessionStatus(session, runningIds);

      // Dispatcher sessions are internal platform tasks — never shown in Task Center
      if (kind === 'dispatcher') continue;

      // "Recent run" scope: all non-dispatcher sessions (any workspace / system), time-sorted in hook return
      if (scope.kind === 'running') {
        const title = session.title?.trim() || session.sessionId.slice(0, 6);
        if (qNorm && !matchesQuery(title)) continue;
        const ws = workspaces.find((w) => w.id === session.workspaceId?.trim())
          ?? findWorkspaceForSession(session, workspaces);
        items.push({
          id: session.sessionId,
          kind,
          source: 'session',
          status,
          title,
          workspaceId: ws?.id,
          workspaceName: ws?.name,
          updatedAt: session.lastActiveAt ?? session.updatedAt ?? session.createdAt,
          payload: session,
        });
        continue;
      }

      // Determine whether this session belongs to a known user workspace
      const sessionWsId = session.workspaceId?.trim();
      const userWorkspace = sessionWsId
        ? workspaces.find((w) => w.id === sessionWsId)
        : findWorkspaceForSession(session, workspaces);

      // A session is "system-level" if it has no matching user workspace,
      // or if it is deepResearch / liveAppStudio / agentAppStudio (always global by design).
      const isSystemLevel =
        kind === 'deepResearch' ||
        kind === 'liveAppStudio' ||
        kind === 'agentAppStudio' ||
        !userWorkspace;

      if (scope.kind === 'system') {
        if (!isSystemLevel) continue;
      } else {
        // Workspace scope: must belong to this specific workspace and not be system-level
        if (isSystemLevel) continue;
        if (!userWorkspace || userWorkspace.id !== scope.id) continue;
      }

      const title = session.title?.trim() || session.sessionId.slice(0, 6);
      if (qNorm && !matchesQuery(title)) continue;

      const scopeWsId = scope.kind === 'workspace' ? scope.id : undefined;
      const ws = workspaces.find((w) => w.id === (session.workspaceId?.trim() ?? scopeWsId))
        ?? (scopeWsId ? workspaces.find((w) => w.id === scopeWsId) : undefined);

      items.push({
        id: session.sessionId,
        kind,
        source: 'session',
        status,
        title,
        workspaceId: ws?.id,
        workspaceName: ws?.name,
        updatedAt: session.lastActiveAt ?? session.updatedAt ?? session.createdAt,
        payload: session,
      });
    }

    if (scope.kind === 'running') {
      items.sort((a, b) => {
        const d = b.updatedAt - a.updatedAt;
        if (d !== 0) return d;
        return a.id.localeCompare(b.id);
      });
    }

    return items;
  }, [scope, flowState.sessions, runningIds, runningLiveApps, workspaces, matchesQuery, qNorm]);

  const groups = useMemo<Array<{ kind: AgentKind; items: TaskItem[] }>>(() => {
    if (scope.kind === 'running') {
      // AgentBoard renders this scope as a single flat, paginated list (not grouped-by-agent).
      return allItems.length ? [{ kind: 'other', items: allItems }] : [];
    }

    const map = new Map<AgentKind, TaskItem[]>();
    for (const item of allItems) {
      const bucket = map.get(item.kind);
      if (bucket) bucket.push(item);
      else map.set(item.kind, [item]);
    }

    const order = scope.kind === 'system' ? SYSTEM_GROUP_ORDER : WORKSPACE_GROUP_ORDER;
    return order
      .filter((k) => map.has(k))
      .map((k) => ({ kind: k, items: map.get(k)! }));
  }, [allItems, scope.kind]);

  const runningCount = useMemo(
    () => allItems.filter((i) => i.status === 'running').length,
    [allItems]
  );

  return {
    groups,
    all: allItems,
    runningCount,
    totalCount: allItems.length,
  };
}
