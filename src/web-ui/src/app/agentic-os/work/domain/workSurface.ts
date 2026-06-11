import type { WorkRecord, WorkSurfaceRef } from './workTypes';

export function findWorkSessionSurface(work: WorkRecord): Extract<WorkSurfaceRef, { kind: 'work_session' }> | null {
  return work.surfaces.find((surface): surface is Extract<WorkSurfaceRef, { kind: 'work_session' }> =>
    surface.kind === 'work_session'
  ) ?? null;
}

export function resolveDefaultWorkSurface(work: WorkRecord): WorkSurfaceRef {
  const workSession = findWorkSessionSurface(work);
  if (workSession) return workSession;
  if (work.primarySurface.kind !== 'os_agent_home') return work.primarySurface;
  return { kind: 'work_center', workId: work.id };
}
