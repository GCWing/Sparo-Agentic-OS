import type { WorkProjection } from './workProjection';

export function workMatchesQuery(work: WorkProjection, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return (
    work.title.toLowerCase().includes(normalized) ||
    work.objective.toLowerCase().includes(normalized) ||
    work.id.toLowerCase().includes(normalized) ||
    (work.workspacePath?.toLowerCase().includes(normalized) ?? false)
  );
}
