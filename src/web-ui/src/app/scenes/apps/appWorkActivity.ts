import type { WorkAppRef, WorkRecord, WorkStatus } from '@/app/agentic-os/work/domain/workTypes';

export interface AppWorkActivity {
  work: WorkRecord;
  appRef: WorkAppRef;
}

const OPEN_APP_WORK_STATUSES = new Set<WorkStatus>([
  'active',
  'running',
  'waiting_user',
  'blocked',
  'paused',
  'interrupted',
]);

export function appRefFromWork(work: WorkRecord): WorkAppRef | null {
  if (work.subject.kind === 'app') return work.subject.app;
  return work.appRefs.find(({ role }) => role === 'subject')?.app
    ?? work.appRefs.find(({ role }) => role === 'executor')?.app
    ?? work.appRefs[0]?.app
    ?? null;
}

/** The App Center's running projection is derived from resumable Work, never process state. */
export function selectOpenAppWorkActivities(works: WorkRecord[]): AppWorkActivity[] {
  return works
    .filter((work) => OPEN_APP_WORK_STATUSES.has(work.status))
    .map((work) => ({ work, appRef: appRefFromWork(work) }))
    .filter((item): item is AppWorkActivity => Boolean(item.appRef))
    .sort((left, right) => right.work.updatedAt - left.work.updatedAt);
}

export function selectDistinctOpenAppWorkActivities(
  activities: AppWorkActivity[],
  limit: number,
): AppWorkActivity[] {
  const selected: AppWorkActivity[] = [];
  const seenAppIds = new Set<string>();
  for (const activity of activities) {
    if (selected.length >= limit) break;
    if (seenAppIds.has(activity.appRef.appId)) continue;
    seenAppIds.add(activity.appRef.appId);
    selected.push(activity);
  }
  return selected;
}
