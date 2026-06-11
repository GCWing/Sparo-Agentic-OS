import type { WorkKind, WorkStatus } from './workTypes';

export type WorkCategory = 'immediate' | 'long_term' | 'recurring';
export type WorkPriorityGroup =
  | 'needs_attention'
  | 'running'
  | 'recurring'
  | 'long_term'
  | 'immediate'
  | 'done';

const LONG_TERM_WORK_KINDS = new Set<WorkKind>([
  'long_running_session',
  'tracking',
  'topic',
  'app_workflow',
]);

export function getWorkCategory(kind: WorkKind): WorkCategory {
  if (kind === 'recurring') return 'recurring';
  if (LONG_TERM_WORK_KINDS.has(kind)) return 'long_term';
  return 'immediate';
}

export function isWorkAttentionStatus(status: WorkStatus): boolean {
  return status === 'waiting_user' || status === 'blocked' || status === 'failed';
}

export function isWorkRunningStatus(status: WorkStatus): boolean {
  return status === 'running';
}

export function isWorkOpenStatus(status: WorkStatus): boolean {
  return status !== 'completed' && status !== 'archived';
}

export function isWorkUnarchivedStatus(status: WorkStatus): boolean {
  return status !== 'archived';
}

export function isWorkCompletedStatus(status: WorkStatus): boolean {
  return status === 'completed';
}

export function isWorkArchivedStatus(status: WorkStatus): boolean {
  return status === 'archived';
}

export function isWorkTerminalStatus(status: WorkStatus): boolean {
  return status === 'completed' || status === 'archived';
}

export function getWorkPriorityGroup(kind: WorkKind, status: WorkStatus): WorkPriorityGroup {
  if (isWorkAttentionStatus(status)) return 'needs_attention';
  if (isWorkRunningStatus(status)) return 'running';
  if (isWorkTerminalStatus(status)) return 'done';

  const category = getWorkCategory(kind);
  if (category === 'recurring') return 'recurring';
  if (category === 'long_term') return 'long_term';
  return 'immediate';
}
