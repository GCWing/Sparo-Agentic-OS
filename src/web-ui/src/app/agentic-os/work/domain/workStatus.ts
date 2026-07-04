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
  if (workHasRunningExecution(work)) return 'running';
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
