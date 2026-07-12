import { describe, expect, it } from 'vitest';
import type { WorkRecord, WorkSurfaceRef } from '../domain/workTypes';
import { resolveWorkSurface } from './workSurfaceResolver';

const applicationSurface: WorkSurfaceRef = {
  kind: 'application_surface',
  productAppId: 'builtin-excel-live',
  productAppSurfaceId: 'excel-surface',
  surfaceId: 'primary',
};

function workWithSurfaces(surfaces: WorkSurfaceRef[]): WorkRecord {
  return {
    id: 'work-1',
    kind: 'app_workflow',
    title: 'Excel Live',
    objective: 'Edit a workbook',
    status: 'active',
    visibility: 'primary',
    subject: { kind: 'goal' },
    appRefs: [],
    scope: { kind: 'system' },
    primarySurface: applicationSurface,
    surfaces,
    lifecycle: { events: [] },
    sessionRefs: [],
    executionBindings: [],
    runtimeInstances: [],
    artifactRefs: [],
    memoryRefs: [],
    systemManaged: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('resolveWorkSurface', () => {
  it('resumes a composite Product App through its linked conversation shell', () => {
    const linkedSession: WorkSurfaceRef = { kind: 'agent_session', sessionId: 'excel-session' };

    expect(resolveWorkSurface(workWithSurfaces([applicationSurface, linkedSession])))
      .toEqual(linkedSession);
  });

  it('keeps the application surface for a Work without a linked session', () => {
    expect(resolveWorkSurface(workWithSurfaces([applicationSurface])))
      .toEqual(applicationSurface);
  });

  it('keeps an owned Work session ahead of linked application sessions', () => {
    const workSession: WorkSurfaceRef = { kind: 'work_session', sessionId: 'work-session' };
    const linkedSession: WorkSurfaceRef = { kind: 'agent_session', sessionId: 'app-session' };

    expect(resolveWorkSurface(workWithSurfaces([applicationSurface, linkedSession, workSession])))
      .toEqual(workSession);
  });

  it('prefers the most recent linked Product App session', () => {
    const older: WorkSurfaceRef = { kind: 'agent_session', sessionId: 'older' };
    const newer: WorkSurfaceRef = { kind: 'agent_session', sessionId: 'newer' };

    expect(resolveWorkSurface(
      workWithSurfaces([applicationSurface, newer, older]),
      { getSessionRecency: id => (id === 'newer' ? 20 : 10) },
    )).toEqual(newer);
  });

  it('keeps newest-link order when only older session metadata is preloaded', () => {
    const older: WorkSurfaceRef = { kind: 'agent_session', sessionId: 'older-known' };
    const newest: WorkSurfaceRef = { kind: 'agent_session', sessionId: 'newest-not-loaded' };

    expect(resolveWorkSurface(
      workWithSurfaces([applicationSurface, older, newest]),
      { getSessionRecency: id => (id === 'older-known' ? 10 : undefined) },
    )).toEqual(newest);
  });

  it('ignores a more active linked session owned by another interaction', () => {
    const excel: WorkSurfaceRef = { kind: 'agent_session', sessionId: 'excel-session' };
    const unrelated: WorkSurfaceRef = { kind: 'agent_session', sessionId: 'runno-session' };

    expect(resolveWorkSurface(
      workWithSurfaces([applicationSurface, excel, unrelated]),
      {
        getSessionRecency: id => (id === 'runno-session' ? 30 : 20),
        isLinkedSessionCompatible: id => id === 'excel-session',
      },
    )).toEqual(excel);
  });
});
