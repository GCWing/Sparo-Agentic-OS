import type { WorkRecord, WorkSurfaceRef } from './workTypes';

export function findWorkSessionSurface(work: WorkRecord): Extract<WorkSurfaceRef, { kind: 'work_session' }> | null {
  return work.surfaces.find((surface): surface is Extract<WorkSurfaceRef, { kind: 'work_session' }> =>
    surface.kind === 'work_session'
  ) ?? null;
}

/**
 * Composite Product Apps keep their application surface as the Work's primary
 * attention target, then link the chat shell as an agent_session surface.
 * Resuming through that linked session lets the chat render immediately while
 * the application sidecar restores independently.
 */
export function findLinkedAgentSessionSurface(
  work: WorkRecord,
  getSessionRecency?: (sessionId: string) => number | undefined,
  isSessionCompatible?: (sessionId: string) => boolean | undefined,
): Extract<WorkSurfaceRef, { kind: 'agent_session' }> | null {
  // Work bindings are append-only. Prefer the most recently linked session so
  // singleton Product Apps (for example one Excel Work serving several files)
  // do not keep reopening their oldest conversation.
  const candidates = work.surfaces
    .filter((surface): surface is Extract<WorkSurfaceRef, { kind: 'agent_session' }> => (
      surface.kind === 'agent_session'
    ))
    .map(surface => ({
      surface,
      compatibility: isSessionCompatible?.(surface.sessionId),
    }))
    .filter(candidate => candidate.compatibility !== false);
  return candidates
    .map((candidate, index) => ({
      ...candidate,
      index,
      recency: getSessionRecency?.(candidate.surface.sessionId),
    }))
    .sort((left, right) => {
      if (left.compatibility !== right.compatibility) {
        return Number(right.compatibility === true) - Number(left.compatibility === true);
      }
      if (left.recency !== undefined && right.recency !== undefined) {
        const recencyOrder = right.recency - left.recency;
        if (recencyOrder !== 0) return recencyOrder;
      }
      // Partial metadata preload is not evidence that an unknown candidate is
      // older; retain append order until both sides can be compared.
      return right.index - left.index;
    })[0]?.surface ?? null;
}

export function resolveDefaultWorkSurface(work: WorkRecord): WorkSurfaceRef {
  const workSession = findWorkSessionSurface(work);
  if (workSession) return workSession;
  if (work.primarySurface.kind !== 'os_agent_home') return work.primarySurface;
  return { kind: 'work_center', workId: work.id };
}
