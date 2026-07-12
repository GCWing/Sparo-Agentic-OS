import { describe, expect, it } from 'vitest';
import type { WorkRecord } from './workTypes';
import { resolveEffectiveWorkStatus, workHasRunningExecution } from './workStatus';

function workWithBindings(
  status: WorkRecord['status'],
  executionBindings: WorkRecord['executionBindings']
): WorkRecord {
  return {
    id: 'work_1',
    kind: 'app_workflow',
    title: 'Product App Work',
    objective: 'Use the Product App',
    status,
    visibility: 'primary',
    subject: {
      kind: 'app',
      app: {
        kind: 'product_app',
        slotId: 'primary',
        appId: 'product-app-1',
        releaseId: 'release-product-app-1',
        configRevision: 'sha256:config',
        dataSchemaVersion: '1',
      },
      intent: 'run',
    },
    appRefs: [],
    scope: { kind: 'system' },
    primarySurface: {
      kind: 'application_surface',
      productAppId: 'product-app-1',
      productAppSurfaceId: 'product-app-1-surface',
      surfaceId: 'primary',
    },
    surfaces: [],
    lifecycle: { events: [] },
    sessionRefs: [],
    executionBindings,
    runtimeInstances: [],
    artifactRefs: [],
    memoryRefs: [],
    systemManaged: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('resolveEffectiveWorkStatus', () => {
  it('does not treat application surface open as running work', () => {
    const work = workWithBindings('running', [
      {
        id: 'exec_surface_open',
        status: 'running',
        source: {
          source: 'application_action',
          applicationId: 'product-app-1',
          actionId: 'surface.open',
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    expect(workHasRunningExecution(work)).toBe(false);
    expect(resolveEffectiveWorkStatus(work)).toBe('active');
  });

  it('treats an active agent turn as running work', () => {
    const work = workWithBindings('active', [
      {
        id: 'exec_agent_turn',
        status: 'running',
        source: {
          source: 'agent_session_run',
          sessionId: 'session-1',
          turnId: 'turn-1',
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    expect(workHasRunningExecution(work)).toBe(true);
    expect(resolveEffectiveWorkStatus(work)).toBe('running');
  });

  it('keeps system-managed running status without execution bindings', () => {
    const work = {
      ...workWithBindings('running', []),
      kind: 'recurring' as const,
      systemManaged: true,
      systemProcessKind: 'daily_letter',
      subject: { kind: 'goal' as const },
      primarySurface: { kind: 'work_center' as const, workId: 'sysbp_daily_letter' },
    };

    expect(workHasRunningExecution(work)).toBe(false);
    expect(resolveEffectiveWorkStatus(work)).toBe('running');
  });
});
