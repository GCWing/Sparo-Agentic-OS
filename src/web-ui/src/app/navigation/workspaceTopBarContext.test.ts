import { describe, expect, it } from 'vitest';
import type { WorkRecord } from '@/app/agentic-os/work/domain/workTypes';
import { resolveWorkContextForSurface } from './workspaceTopBarContext';

function createWork(): WorkRecord {
  return {
    id: 'work-1',
    kind: 'multi_step',
    title: 'E2E测试任务确认',
    objective: 'Run E2E confirmation',
    status: 'running',
    visibility: 'primary',
    subject: { kind: 'goal' },
    appRefs: [],
    scope: { kind: 'system' },
    primarySurface: { kind: 'work_session', sessionId: 'session-1' },
    surfaces: [],
    lifecycle: { events: [] },
    sessionRefs: [],
    executionBindings: [],
    runtimeInstances: [],
    artifactRefs: [],
    memoryRefs: [],
    systemManaged: false,
    createdAt: 1,
    updatedAt: 2,
  };
}

describe('resolveWorkContextForSurface', () => {
  it('resolves work title from explicit navigation context', () => {
    const context = resolveWorkContextForSurface(
      { kind: 'work', workId: 'work-1' },
      [createWork()]
    );

    expect(context).toEqual({
      workId: 'work-1',
      title: 'E2E测试任务确认',
    });
  });

  it('does not infer work title from a session without explicit work context', () => {
    const context = resolveWorkContextForSurface(null, [createWork()]);

    expect(context).toBeNull();
  });

  it('returns null when the context references a work record that is not loaded', () => {
    const context = resolveWorkContextForSurface(
      { kind: 'work', workId: 'missing-work' },
      [createWork()]
    );

    expect(context).toBeNull();
  });
});
