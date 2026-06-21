import type { WorkRecord } from '@/app/agentic-os/work/domain/workTypes';
import type { WorkspaceSurfaceContext } from './workspaceSurfaceTypes';

export interface WorkspaceTopBarWorkContext {
  workId: string;
  title: string;
}

export function resolveWorkContextForSurface(
  context: WorkspaceSurfaceContext | null,
  works: readonly WorkRecord[]
): WorkspaceTopBarWorkContext | null {
  if (context?.kind !== 'work') {
    return null;
  }

  const work = works.find(candidate => candidate.id === context.workId);
  if (!work) {
    return null;
  }

  return {
    workId: work.id,
    title: work.title.trim() || work.id.slice(0, 10),
  };
}
