import type { WorkRecord, WorkSurfaceRef } from '../domain/workTypes';
import { resolveDefaultWorkSurface } from '../domain/workSurface';

export function resolveWorkSurface(work: WorkRecord): WorkSurfaceRef {
  return resolveDefaultWorkSurface(work);
}
