import type { WorkProjection } from './workProjection';

export function compareWorksForDisplay(a: WorkProjection, b: WorkProjection): number {
  const byTime = b.updatedAt - a.updatedAt;
  if (byTime !== 0) return byTime;
  return a.id.localeCompare(b.id);
}
