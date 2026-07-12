import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkDockStore } from '@/app/stores/workDockStore';
import { openArtifactInCenter, openWork, openWorkInCenter } from './openWork';
import { openWorkspaceScene } from '@/app/navigation/workspaceNavigation';
import { openMainSession } from '@/flow_chat/services/childSessionPanels';
import { openProductAppRuntimeForWorkSurface } from '@/app/scenes/apps/product-app-runtime/productAppRuntimeService';
import type { WorkRecord, WorkSurfaceRef } from '../domain/workTypes';
import {
  cancelPendingSessionNavigation,
  commitPendingSessionNavigation,
} from '@/app/navigation/navigationController';

const navigationMock = vi.hoisted(() => ({ epoch: 0 }));

vi.mock('@/app/navigation/workspaceNavigation', () => ({
  openWorkspaceScene: vi.fn(),
}));
vi.mock('@/flow_chat/services/childSessionPanels', () => ({
  openMainSession: vi.fn(),
}));
vi.mock('@/app/navigation/navigationController', () => ({
  beginNavigationIntent: vi.fn(() => ++navigationMock.epoch),
  cancelPendingSessionNavigation: vi.fn(() => true),
  commitPendingSessionNavigation: vi.fn(() => true),
  getNavigationEpoch: vi.fn(() => navigationMock.epoch),
}));
vi.mock('@/app/scenes/apps/product-app-runtime/productAppRuntimeService', () => ({
  openProductAppRuntimeForWorkSurface: vi.fn(),
}));

function resetWorkDockStore() {
  useWorkDockStore.setState({
    workCenterScope: { kind: 'open' },
    workCenterWorkspaceFilter: { kind: 'all' },
    workCenterAppFilter: { kind: 'all' },
    workCenterGrouping: 'priority',
    workCenterSelectedWorkId: null,
    workCenterSelectedArtifactId: null,
    workCenterCollapsedGroups: [],
  });
}

const applicationSurface: WorkSurfaceRef = {
  kind: 'application_surface',
  productAppId: 'builtin-excel-live',
  productAppSurfaceId: 'excel-surface',
  surfaceId: 'primary',
};

function appWork(id: string, surfaces: WorkSurfaceRef[]): WorkRecord {
  return {
    id,
    kind: 'app_workflow',
    title: `Work ${id}`,
    objective: 'Edit a workbook',
    status: 'active',
    visibility: 'primary',
    subject: {
      kind: 'app',
      app: { kind: 'product_app', appId: 'builtin-excel-live' },
      intent: 'run',
    },
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

describe('openWork navigation', () => {
  beforeEach(() => {
    resetWorkDockStore();
    navigationMock.epoch = 0;
    vi.mocked(openWorkspaceScene).mockClear();
    vi.mocked(openMainSession).mockReset().mockResolvedValue('opened');
    vi.mocked(openProductAppRuntimeForWorkSurface).mockReset().mockResolvedValue(undefined);
    vi.mocked(commitPendingSessionNavigation).mockClear();
    vi.mocked(cancelPendingSessionNavigation).mockClear();
  });

  it('opens an artifact in its owner Work Center context', () => {
    openArtifactInCenter('work_1', 'artifact_1');

    const state = useWorkDockStore.getState();
    expect(state.workCenterScope).toEqual({ kind: 'all' });
    expect(state.workCenterSelectedWorkId).toBe('work_1');
    expect(state.workCenterSelectedArtifactId).toBe('artifact_1');
    expect(openWorkspaceScene).toHaveBeenCalledWith('work-center');
  });

  it('clears artifact focus when opening a Work directly', () => {
    openArtifactInCenter('work_1', 'artifact_1');

    openWorkInCenter('work_2');

    const state = useWorkDockStore.getState();
    expect(state.workCenterSelectedWorkId).toBe('work_2');
    expect(state.workCenterSelectedArtifactId).toBeNull();
  });

  it('opens an existing composite Product App session before runtime resolution', async () => {
    const linkedSession: WorkSurfaceRef = { kind: 'agent_session', sessionId: 'excel-session' };

    await openWork(appWork('work-excel', [applicationSurface, linkedSession]));

    expect(openMainSession).toHaveBeenCalledWith('excel-session', {
      context: { kind: 'work', workId: 'work-excel' },
      commitPendingSurface: true,
      navigationEpoch: 1,
    });
    expect(openProductAppRuntimeForWorkSurface).not.toHaveBeenCalled();
  });

  it('coalesces repeated opens while the same Work is preparing', async () => {
    let release!: () => void;
    vi.mocked(openProductAppRuntimeForWorkSurface).mockImplementation(() => (
      new Promise<void>((resolve) => { release = resolve; })
    ));
    const work = appWork('work-slow', [applicationSurface]);

    const first = openWork(work);
    const second = openWork(work);
    await Promise.resolve();

    expect(openProductAppRuntimeForWorkSurface).toHaveBeenCalledTimes(1);
    expect(commitPendingSessionNavigation).toHaveBeenCalledWith(
      'pending-work:work-slow',
      expect.objectContaining({
        context: { kind: 'work', workId: 'work-slow' },
        navigationEpoch: 1,
      }),
    );
    release();
    await Promise.all([first, second]);
    expect(cancelPendingSessionNavigation).toHaveBeenCalledWith(1);
  });

  it('invalidates an older Work preparation when a newer Work is selected', async () => {
    const guards = new Map<string, () => boolean>();
    vi.mocked(openProductAppRuntimeForWorkSurface).mockImplementation(async (request, options) => {
      guards.set(request.workId, options.isNavigationCurrent!);
    });

    await openWork(appWork('work-a', [applicationSurface]));
    const guardA = guards.get('work-a')!;
    expect(guardA()).toBe(true);

    await openWork(appWork('work-b', [applicationSurface]));

    expect(guardA()).toBe(false);
    expect(guards.get('work-b')?.()).toBe(true);
  });

  it('falls back to the application surface when a linked session is missing', async () => {
    vi.mocked(openMainSession).mockResolvedValueOnce('missing');
    const linkedSession: WorkSurfaceRef = { kind: 'agent_session', sessionId: 'deleted-session' };

    await openWork(appWork('work-fallback', [applicationSurface, linkedSession]));

    expect(openProductAppRuntimeForWorkSurface).toHaveBeenCalledWith(
      expect.objectContaining({ workId: 'work-fallback', appId: 'builtin-excel-live' }),
      expect.objectContaining({ context: { kind: 'work', workId: 'work-fallback' } }),
    );
  });
});
