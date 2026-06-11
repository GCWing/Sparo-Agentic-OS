import type { WorkExecutionBinding, WorkRecord, WorkStatus } from './workTypes';

const RUNNING_BINDING_STATUSES = new Set(['queued', 'running', 'waiting_user']);

export function workHasRunningExecution(work: WorkRecord): boolean {
  return work.executionBindings.some((binding: WorkExecutionBinding) =>
    RUNNING_BINDING_STATUSES.has(binding.status)
  );
}

export function resolveEffectiveWorkStatus(work: WorkRecord): WorkStatus {
  if (workHasRunningExecution(work)) return 'running';
  return work.status;
}

export function isTerminalWorkStatus(status: WorkStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'archived';
}
