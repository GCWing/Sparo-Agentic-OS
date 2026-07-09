import type { WorkExecutionBinding, WorkRecord, WorkStatus } from './workTypes';

const RUNNING_BINDING_STATUSES = new Set(['queued', 'running', 'waiting_user']);

function isPassiveApplicationSurfaceOpen(binding: WorkExecutionBinding): boolean {
  return binding.source.source === 'application_action'
    && binding.source.actionId === 'surface.open';
}

export function workHasRunningExecution(work: WorkRecord): boolean {
  return work.executionBindings.some((binding: WorkExecutionBinding) =>
    RUNNING_BINDING_STATUSES.has(binding.status)
      && !isPassiveApplicationSurfaceOpen(binding)
  );
}

export function resolveEffectiveWorkStatus(work: WorkRecord): WorkStatus {
  // System matters sync status from BackgroundProcess and have no agent
  // execution bindings. Trust the persisted status so running system jobs
  // (daily letter, memory consolidation, etc.) stay visible in Running Work.
  if (work.systemManaged) {
    return work.status;
  }
  if (workHasRunningExecution(work)) return 'running';
  // Stale running without a live binding: treat as idle/active for user work.
  if (work.status === 'running') return 'active';
  return work.status;
}

export function isTerminalWorkStatus(status: WorkStatus): boolean {
  return status === 'completed'
    || status === 'failed'
    || status === 'cancelled'
    || status === 'interrupted'
    || status === 'archived';
}
