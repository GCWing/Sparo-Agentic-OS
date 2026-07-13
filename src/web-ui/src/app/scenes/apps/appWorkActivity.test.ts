import { describe, expect, it } from 'vitest';
import { nativeAppWorkRef } from '@/app/agentic-os/work/domain/productAppRefs';
import type { WorkRecord, WorkStatus } from '@/app/agentic-os/work/domain/workTypes';
import {
  selectDistinctOpenAppWorkActivities,
  selectOpenAppWorkActivities,
} from './appWorkActivity';

function work(
  id: string,
  appId: string,
  status: WorkStatus,
  updatedAt: number,
): WorkRecord {
  const app = nativeAppWorkRef(appId);
  return {
    id,
    title: id,
    status,
    updatedAt,
    subject: { kind: 'component', component: { componentId: id, componentKind: 'test' }, intent: 'develop' },
    appRefs: [{ app, role: 'executor' }],
  } as unknown as WorkRecord;
}

describe('appWorkActivity', () => {
  it('projects every resumable Work regardless of app multiplicity or worker state', () => {
    const activities = selectOpenAppWorkActivities([
      work('spark-active', 'spark-board', 'active', 20),
      work('builder-paused', 'app-builder', 'paused', 30),
      work('finished', 'spark-board', 'completed', 40),
    ]);

    expect(activities.map(({ work: item }) => item.id)).toEqual([
      'builder-paused',
      'spark-active',
    ]);
  });

  it('keeps the newest resumable Work for each app in the compact running dock', () => {
    const activities = selectOpenAppWorkActivities([
      work('spark-new', 'spark-board', 'waiting_user', 30),
      work('spark-old', 'spark-board', 'running', 10),
      work('builder', 'app-builder', 'active', 20),
    ]);

    expect(selectDistinctOpenAppWorkActivities(activities, 4).map(({ work: item }) => item.id))
      .toEqual(['spark-new', 'builder']);
  });
});
