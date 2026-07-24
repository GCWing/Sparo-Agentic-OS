import { describe, expect, it } from 'vitest';
import type { WorkAppRef, WorkAppRelation, WorkSubject } from './workTypes';
import { getPrimaryWorkAppRef, workUsesOwnAppIcon } from './workAppIdentity';

const subjectApp: WorkAppRef = {
  kind: 'product_app',
  slotId: 'subject-slot',
  appId: 'subject-app',
  releaseId: 'release-1',
  configRevision: 'config-1',
  dataSchemaVersion: '1',
};

const executorApp: WorkAppRef = {
  ...subjectApp,
  slotId: 'executor-slot',
  appId: 'executor-app',
};

function source(
  subject: WorkSubject,
  appRefs: WorkAppRelation[],
  kind: 'app_workflow' | 'delegated_work' = 'app_workflow',
) {
  return { kind, subject, appRefs };
}

describe('workAppIdentity', () => {
  it('prefers the App subject over relation order', () => {
    expect(getPrimaryWorkAppRef(source(
      { kind: 'app', app: subjectApp, intent: 'run' },
      [{ app: executorApp, role: 'executor' }],
    ))).toBe(subjectApp);
  });

  it('uses role priority instead of array order for App workflow identity', () => {
    expect(getPrimaryWorkAppRef(source(
      { kind: 'goal' },
      [
        { app: executorApp, role: 'context' },
        { app: subjectApp, role: 'subject' },
      ],
    ))).toBe(subjectApp);
  });

  it('uses an App logo only for App-owned Work', () => {
    expect(workUsesOwnAppIcon(source(
      { kind: 'goal' },
      [{ app: executorApp, role: 'executor' }],
    ))).toBe(true);
    expect(workUsesOwnAppIcon(source(
      { kind: 'goal' },
      [{ app: executorApp, role: 'executor' }],
      'delegated_work',
    ))).toBe(false);
  });
});
