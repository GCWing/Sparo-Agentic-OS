import { AppWindow, Brush, Clock3, Code2, ListChecks, ListTodo, MessageSquare, Sparkles } from 'lucide-react';
import { filterWorkProjections } from '@/app/agentic-os/work/data/workSelectors';
import { isWorkAttentionStatus, isWorkRunningStatus } from '@/app/agentic-os/work/domain/workClassification';
import type { WorkKind, WorkStatus } from '@/app/agentic-os/work/domain/workTypes';
import type { WorkProjection } from '@/app/agentic-os/work/projections/workProjection';

export const WORK_DOCK_LIST_LIMIT = 9;

export interface WorkListSelectionOptions {
  query?: string;
  maxWorks?: number;
  runningFilter?: 'all' | 'running' | 'not-running';
  includeArchived?: boolean;
  includeCompleted?: boolean;
}

export function isFocusStatus(status: WorkStatus): boolean {
  return isWorkRunningStatus(status) || isWorkAttentionStatus(status);
}

export function statusKey(status: WorkStatus): string {
  return status.replace(/_/g, '-');
}

function hasSessionLikeSurface(work: WorkProjection): boolean {
  return work.primarySurface.kind === 'work_session'
    || work.primarySurface.kind === 'agent_session'
    || work.surfaces?.some((surface) => (
      surface.kind === 'work_session' || surface.kind === 'agent_session'
    )) === true;
}

export function getWorkModeIcon(work: WorkProjection) {
  if (work.kind === 'app_workflow') {
    if (hasSessionLikeSurface(work)) return MessageSquare;
    if (work.primarySurface.kind === 'application_surface') return AppWindow;
    return Sparkles;
  }
  const { kind } = work;
  if (kind === 'tracking' || kind === 'recurring') return ListTodo;
  if (kind === 'topic') return Brush;
  if (kind === 'long_running_session') return Clock3;
  if (kind === 'one_shot' || kind === 'multi_step' || kind === 'delegated_work') return ListChecks;
  return Code2;
}

export function getWorkToneValue(status: WorkStatus): string {
  if (status === 'waiting_user' || status === 'blocked') return 'var(--ds-color-warning)';
  if (status === 'failed') return 'var(--ds-color-danger)';
  if (status === 'completed') return 'var(--ds-color-success)';
  if (status === 'running') return 'var(--ds-color-accent-500)';
  return 'var(--ds-color-text-muted)';
}

export function isInstrumentedStatus(status: WorkStatus): boolean {
  return status === 'running'
    || status === 'waiting_user'
    || status === 'blocked'
    || status === 'failed'
    || status === 'paused'
    || status === 'completed'
    || status === 'cancelled'
    || status === 'interrupted';
}

function statusPriority(status: WorkStatus): number {
  switch (status) {
    case 'waiting_user':
      return 0;
    case 'blocked':
      return 1;
    case 'failed':
      return 2;
    case 'running':
      return 3;
    case 'active':
      return 4;
    case 'paused':
      return 5;
    case 'draft':
      return 6;
    case 'completed':
      return 7;
    case 'cancelled':
      return 8;
    case 'interrupted':
      return 9;
    case 'archived':
      return 10;
  }
}

function kindContinuityPriority(kind: WorkKind): number {
  switch (kind) {
    case 'recurring':
      return 0;
    case 'long_running_session':
    case 'tracking':
    case 'topic':
      return 1;
    case 'app_workflow':
      return 2;
    case 'multi_step':
    case 'delegated_work':
      return 3;
    case 'one_shot':
      return 4;
  }
}

export function compareWorksForDock(left: WorkProjection, right: WorkProjection): number {
  const byStatus = statusPriority(left.status) - statusPriority(right.status);
  if (byStatus !== 0) return byStatus;
  const byKind = kindContinuityPriority(left.kind) - kindContinuityPriority(right.kind);
  if (byKind !== 0) return byKind;
  const byTime = right.updatedAt - left.updatedAt;
  if (byTime !== 0) return byTime;
  return left.id.localeCompare(right.id);
}

export function selectWorksForDockList(
  projections: WorkProjection[],
  {
    query = '',
    maxWorks,
    runningFilter = 'all',
    includeArchived = false,
    includeCompleted = true,
  }: WorkListSelectionOptions = {}
): WorkProjection[] {
  const filtered = filterWorkProjections(projections, query)
    .filter((work) => {
      const running = isFocusStatus(work.status);
      if (runningFilter === 'running') return running;
      if (runningFilter === 'not-running') return !running;
      return true;
    })
    .filter((work) => (includeArchived ? true : work.status !== 'archived'))
    .filter((work) => (
      includeCompleted
        ? true
        : work.status !== 'completed'
          && work.status !== 'cancelled'
          && work.status !== 'interrupted'
    ))
    .sort(compareWorksForDock);

  return typeof maxWorks === 'number' ? filtered.slice(0, maxWorks) : filtered;
}
