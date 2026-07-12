import type { WorkRecord, WorkSurfaceRef } from '../domain/workTypes';
import {
  findLinkedAgentSessionSurface,
  resolveDefaultWorkSurface,
} from '../domain/workSurface';

export interface ResolveWorkSurfaceOptions {
  getSessionRecency?: (sessionId: string) => number | undefined;
  isLinkedSessionCompatible?: (sessionId: string) => boolean | undefined;
}

export function resolveWorkSurface(
  work: WorkRecord,
  options: ResolveWorkSurfaceOptions = {},
): WorkSurfaceRef {
  const defaultSurface = resolveDefaultWorkSurface(work);

  // The persisted primary surface still describes where attention belongs.
  // For a composite Product App, however, its linked agent session is the
  // cheapest complete resume shell: it owns both transcript metadata and the
  // application sidecar binding. Do not force every resume through runtime
  // discovery again once that shell exists.
  if (defaultSurface.kind === 'application_surface') {
    return findLinkedAgentSessionSurface(
      work,
      options.getSessionRecency,
      options.isLinkedSessionCompatible,
    ) ?? defaultSurface;
  }

  return defaultSurface;
}
