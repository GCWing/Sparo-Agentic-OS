import { filterWorkProjections } from '@/app/agentic-os/work/data/workSelectors';
import {
  isDockEligibleWork,
  isWorkAttentionStatus,
  isWorkRunningStatus,
} from '@/app/agentic-os/work/domain/workClassification';
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
    case 'multi_step':
    case 'delegated_work':
    case 'app_workflow':
      return 2;
    case 'one_shot':
      return 3;
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
    .filter((work) => isDockEligibleWork(work))
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
