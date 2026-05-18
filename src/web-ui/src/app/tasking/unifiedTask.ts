/**
 * Unified task model for surfaces that need to show runnable work.
 *
 * The task center and left session list both deal with long-lived work:
 * agent sessions and Live App workers. This file keeps the common shape in
 * one place so future task-like runtimes can join the same management layer.
 */
import type { RunningLiveAppItem } from '@/app/scenes/apps/live-app/liveAppTaskView';
import type { AgentKind } from '@/app/scenes/task-detail/taskCenter/agentKinds';
import type { Session } from '@/flow_chat/types/flow-chat';
import type { WorkspaceInfo } from '@/shared/types';

export type UnifiedTaskSource = 'session' | 'liveApp';
export type UnifiedTaskStatus = 'running' | 'active' | 'error' | 'idle';

export interface UnifiedTaskBase<TSource extends UnifiedTaskSource, TKind extends AgentKind, TPayload> {
  id: string;
  kind: TKind;
  source: TSource;
  status: UnifiedTaskStatus;
  title: string;
  workspaceId?: string;
  workspaceName?: string;
  updatedAt: number;
  payload: TPayload;
}

export type UnifiedSessionTask = UnifiedTaskBase<'session', AgentKind, Session>;
export type UnifiedLiveAppTask = UnifiedTaskBase<'liveApp', 'liveApp', RunningLiveAppItem>;
export type UnifiedTask = UnifiedSessionTask | UnifiedLiveAppTask;

export function resolveSessionTaskStatus(
  session: Session,
  runningSessionIds: Set<string>,
): UnifiedTaskStatus {
  if (runningSessionIds.has(session.sessionId)) return 'running';
  if (session.status === 'error') return 'error';
  return 'idle';
}

export function buildSessionTask(params: {
  session: Session;
  kind: AgentKind;
  status: UnifiedTaskStatus;
  workspace?: WorkspaceInfo;
}): UnifiedSessionTask {
  const { session, kind, status, workspace } = params;
  return {
    id: session.sessionId,
    kind,
    source: 'session',
    status,
    title: session.title?.trim() || session.sessionId.slice(0, 6),
    workspaceId: workspace?.id,
    workspaceName: workspace?.name,
    updatedAt: session.lastActiveAt ?? session.updatedAt ?? session.createdAt,
    payload: session,
  };
}

export function buildLiveAppTask(app: RunningLiveAppItem): UnifiedLiveAppTask {
  return {
    id: app.id,
    kind: 'liveApp',
    source: 'liveApp',
    status: 'running',
    title: app.title,
    updatedAt: app.updatedAt,
    payload: app,
  };
}
