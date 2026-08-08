import { describe, expect, it } from 'vitest';
import { nativeAppWorkRef } from '@/app/agentic-os/work/domain/productAppRefs';
import type { WorkRecord, WorkStatus } from '@/app/agentic-os/work/domain/workTypes';
import {
  selectDistinctOpenAppWorkActivities,
  selectLatestOpenAppWorkPerObject,
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

function workForObject(id: string, objectId: string, updatedAt: number): WorkRecord {
  return {
    ...work(id, 'canvas-app', 'active', updatedAt),
    scope: { kind: 'global' },
    objectRefs: [{
      locator: { scope: { kind: 'global' }, objectId },
      kindId: 'canvas',
      role: 'primary',
    }],
  } as WorkRecord;
}

describe('appWorkActivity', () => {
  it('projects every resumable Work regardless of app multiplicity or worker state', () => {
    const activities = selectOpenAppWorkActivities([
      work('canvas-active', 'canvas-app', 'active', 20),
      work('builder-paused', 'app-builder', 'paused', 30),
      work('finished', 'canvas-app', 'completed', 40),
    ]);

    expect(activities.map(({ work: item }) => item.id)).toEqual([
      'builder-paused',
      'canvas-active',
    ]);
  });

  it('keeps the newest resumable Work for each app in the compact running dock', () => {
    const activities = selectOpenAppWorkActivities([
      work('canvas-new', 'canvas-app', 'waiting_user', 30),
      work('canvas-old', 'canvas-app', 'running', 10),
      work('builder', 'app-builder', 'active', 20),
    ]);

    expect(selectDistinctOpenAppWorkActivities(activities, 4).map(({ work: item }) => item.id))
      .toEqual(['canvas-new', 'builder']);
  });

  it('shows one launcher item per durable object while keeping the latest Work', () => {
    const activities = selectOpenAppWorkActivities([
      workForObject('revision-new', 'object-1', 30),
      workForObject('revision-old', 'object-1', 10),
      workForObject('separate-object', 'object-2', 20),
    ]);

    expect(selectLatestOpenAppWorkPerObject(activities).map(({ work: item }) => item.id))
      .toEqual(['revision-new', 'separate-object']);
  });
});
