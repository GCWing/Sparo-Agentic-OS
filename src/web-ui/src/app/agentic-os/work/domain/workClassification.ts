import type { WorkKind, WorkStatus } from './workTypes';

export type WorkCategory = 'immediate' | 'long_term' | 'recurring';

export type WorkRailSection =
  | 'immediate'
  | 'long_term'
  | 'topic'
  | 'recurring'
  | 'system';

export type WorkPriorityGroup =
  | 'needs_attention'
  | 'running'
  | 'recurring'
  | 'long_term'
  | 'immediate'
  | 'done';

/** Explicit continuity kinds only. App attachment (`app_workflow`) is immediate by default. */
const LONG_TERM_WORK_KINDS = new Set<WorkKind>([
  'long_running_session',
  'tracking',
]);

export function getWorkCategory(kind: WorkKind): WorkCategory {
  if (kind === 'recurring') return 'recurring';
  if (kind === 'topic' || LONG_TERM_WORK_KINDS.has(kind)) return 'long_term';
  // one_shot | multi_step | delegated_work | app_workflow → immediate
  return 'immediate';
}

export function getWorkRailSection(input: {
  kind: WorkKind;
  systemManaged?: boolean;
}): WorkRailSection {
  if (input.systemManaged) return 'system';
  if (input.kind === 'topic') return 'topic';
  if (input.kind === 'recurring') return 'recurring';
  if (LONG_TERM_WORK_KINDS.has(input.kind)) return 'long_term';
  return 'immediate';
}

export function isWorkAttentionStatus(status: WorkStatus): boolean {
  return status === 'waiting_user' || status === 'blocked' || status === 'failed';
}

export function isWorkRunningStatus(status: WorkStatus): boolean {
  return status === 'running';
}

export function isWorkOpenStatus(status: WorkStatus): boolean {
  return status !== 'completed'
    && status !== 'cancelled'
    && status !== 'interrupted'
    && status !== 'archived';
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
  return status === 'completed'
    || status === 'cancelled'
    || status === 'interrupted'
    || status === 'archived';
}

export function isQueueEligibleWork(input: {
  systemManaged?: boolean;
  visibility?: string | null;
}): boolean {
  return !input.systemManaged && input.visibility !== 'hidden';
}

/** Work Dock shows actionable user work only — not system matters or recurring cadence items. */
export function isDockEligibleWork(input: {
  kind: WorkKind;
  systemManaged?: boolean;
  visibility?: string | null;
}): boolean {
  if (!isQueueEligibleWork(input)) return false;
  if (input.kind === 'recurring') return false;
  return true;
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

export const RECLASSIFY_KIND_OPTIONS: WorkKind[] = [
  'multi_step',
  'tracking',
  'long_running_session',
  'topic',
  'recurring',
  'app_workflow',
  'one_shot',
];
