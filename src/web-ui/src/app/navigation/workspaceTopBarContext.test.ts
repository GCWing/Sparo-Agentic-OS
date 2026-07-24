import { describe, expect, it } from 'vitest';
import type { WorkRecord } from '@/app/agentic-os/work/domain/workTypes';
import {
  resolveSessionTopBarPresentation,
  resolveWorkContextForSurface,
  resolveWorkspaceTopBarTitle,
} from './workspaceTopBarContext';

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

describe('resolveSessionTopBarPresentation', () => {
  it('shows an Intelligent App name and workspace for a multi-Work app', () => {
    expect(resolveSessionTopBarPresentation({
      sessionLabel: 'Intelligent App',
      workspaceLabel: 'Sparo OS',
      globalScopeLabel: 'Global',
      productApp: {
        appName: 'PPT Live',
        workMultiplicity: 'multiple',
        scopeKind: 'workspace',
      },
    })).toMatchObject({
      identityLabel: 'PPT Live',
      scopeLabel: 'Sparo OS',
      scopeKind: 'workspace',
      title: 'PPT Live / Sparo OS',
      isProductApp: true,
    });
  });

  it('uses Global as the scope for a global multi-Work Intelligent App', () => {
    expect(resolveSessionTopBarPresentation({
      sessionLabel: 'Intelligent App',
      globalScopeLabel: 'Global',
      productApp: {
        appName: 'Deep Research',
        workMultiplicity: 'multiple',
        scopeKind: 'global',
      },
    })).toMatchObject({
      identityLabel: 'Deep Research',
      scopeLabel: 'Global',
      scopeKind: 'global',
      title: 'Deep Research / Global',
    });
  });

  it('shows only the Intelligent App name for a singleton', () => {
    expect(resolveSessionTopBarPresentation({
      sessionLabel: 'Intelligent App',
      workspaceLabel: 'Ignored workspace',
      globalScopeLabel: 'Global',
      productApp: {
        appName: 'Excel Live',
        workMultiplicity: 'singleton',
        scopeKind: 'global',
      },
    })).toMatchObject({
      identityLabel: 'Excel Live',
      scopeLabel: '',
      scopeKind: null,
      title: 'Excel Live',
    });
  });
});

describe('resolveWorkspaceTopBarTitle', () => {
  it('lets the Intelligent App identity own a Product App session title', () => {
    expect(resolveWorkspaceTopBarTitle({
      surfaceKind: 'session',
      sessionPresentation: {
        identityLabel: 'PPT Live',
        scopeLabel: 'Sparo OS',
        scopeKind: 'workspace',
        title: 'PPT Live / Sparo OS',
        isProductApp: true,
      },
      sessionTitle: 'PPT Live / Sparo OS',
      workTitle: 'Quarterly results draft',
    })).toBe('PPT Live / Sparo OS');
  });

  it('keeps Work title precedence for ordinary sessions', () => {
    expect(resolveWorkspaceTopBarTitle({
      surfaceKind: 'session',
      sessionTitle: 'Runno / Sparo OS',
      workTitle: 'Fix the release pipeline',
    })).toBe('Fix the release pipeline');
  });
});
