import type { WorkKind, WorkRecord, WorkStatus, WorkSurfaceRef } from '../domain/workTypes';
import { resolveEffectiveWorkStatus } from '../domain/workStatus';
import { resolveDefaultWorkSurface } from '../domain/workSurface';

export interface WorkProjection {
  id: string;
  kind: WorkKind;
  title: string;
  objective: string;
  status: WorkStatus;
  workspacePath?: string;
  primarySurface: WorkSurfaceRef;
  sessionId?: string;
  updatedAt: number;
}

export function projectWork(work: WorkRecord): WorkProjection {
  const primarySurface = resolveDefaultWorkSurface(work);
  return {
    id: work.id,
    kind: work.kind,
    title: work.title.trim() || work.id.slice(0, 10),
    objective: work.objective,
    status: resolveEffectiveWorkStatus(work),
    workspacePath: work.scope.kind === 'workspace' ? work.scope.workspacePath : undefined,
    primarySurface,
    sessionId:
      primarySurface.kind === 'work_session' || primarySurface.kind === 'agent_session'
        ? primarySurface.sessionId
        : undefined,
    updatedAt: work.updatedAt,
  };
}
