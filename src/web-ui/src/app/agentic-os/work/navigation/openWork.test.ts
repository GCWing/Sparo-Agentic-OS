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

const navigationMock = vi.hoisted(() => ({
  epoch: 0,
  prepareProductAppWork: vi.fn(),
  warning: vi.fn(),
}));

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
vi.mock('@/infrastructure/api/service-api/ProductAppRuntimeAPI', () => ({
  productAppRuntimeAPI: {
    prepareProductAppWork: navigationMock.prepareProductAppWork,
  },
}));
vi.mock('@/shared/notification-system', () => ({
  notificationService: {
    warning: navigationMock.warning,
  },
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

function appWork(
  id: string,
  surfaces: WorkSurfaceRef[],
  scope: WorkRecord['scope'] = { kind: 'global' },
  workspacePath?: string,
): WorkRecord {
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
    scope,
    workspacePath,
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
    navigationMock.prepareProductAppWork.mockReset().mockResolvedValue({
      status: 'compatible',
      slotId: 'excel-live',
      appId: 'builtin-excel-live',
      createdWithReleaseId: 'release-excel-1',
      workDataSchemaVersion: '1',
    });
    navigationMock.warning.mockReset();
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

  it('rebinds an existing composite session through the current runtime', async () => {
    const linkedSession: WorkSurfaceRef = { kind: 'agent_session', sessionId: 'excel-session' };

    await openWork(appWork('work-excel', [applicationSurface, linkedSession]));

    expect(openMainSession).not.toHaveBeenCalled();
    expect(openProductAppRuntimeForWorkSurface).toHaveBeenCalledWith(
      expect.objectContaining({
        workLocator: {
          scope: { kind: 'global' },
          workId: 'work-excel',
        },
        appId: 'builtin-excel-live',
      }),
      expect.objectContaining({ context: { kind: 'work', workId: 'work-excel' } }),
    );
  });

  it('keeps the typed Workspace locator when reopening an application surface', async () => {
    await openWork(appWork(
      'work-workspace',
      [applicationSurface],
      { kind: 'workspace', workspaceId: 'ws_project' },
      'D:/workspace/project',
    ));

    expect(openProductAppRuntimeForWorkSurface).toHaveBeenCalledWith(
      expect.objectContaining({
        workLocator: {
          scope: { kind: 'workspace', workspaceId: 'ws_project' },
          workId: 'work-workspace',
        },
      }),
      expect.objectContaining({
        scope: {
          kind: 'workspace',
          workspaceId: 'ws_project',
          workspacePath: 'D:/workspace/project',
          workspaceName: null,
        },
      }),
    );
  });

  it('coalesces repeated opens while the same Work is preparing', async () => {
    let release!: () => void;
    vi.mocked(openProductAppRuntimeForWorkSurface).mockImplementation(() => (
      new Promise<void>((resolve) => { release = resolve; })
    ));
    const work = appWork('work-slow', [applicationSurface]);

    const first = openWork(work);
    const second = openWork(work);
    await vi.waitFor(() => {
      expect(openProductAppRuntimeForWorkSurface).toHaveBeenCalledTimes(1);
    });
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
      guards.set(request.workLocator.workId, options.isNavigationCurrent!);
    });

    await openWork(appWork('work-a', [applicationSurface]));
    const guardA = guards.get('work-a')!;
    expect(guardA()).toBe(true);

    await openWork(appWork('work-b', [applicationSurface]));

    expect(guardA()).toBe(false);
    expect(guards.get('work-b')?.()).toBe(true);
  });

  it('does not open a stale linked session directly', async () => {
    const linkedSession: WorkSurfaceRef = { kind: 'agent_session', sessionId: 'deleted-session' };

    await openWork(appWork('work-fallback', [applicationSurface, linkedSession]));

    expect(openProductAppRuntimeForWorkSurface).toHaveBeenCalledWith(
      expect.objectContaining({
        workLocator: {
          scope: { kind: 'global' },
          workId: 'work-fallback',
        },
        appId: 'builtin-excel-live',
      }),
      expect.objectContaining({ context: { kind: 'work', workId: 'work-fallback' } }),
    );
    expect(openMainSession).not.toHaveBeenCalled();
  });

  it('keeps incompatible Work data visible without starting old code', async () => {
    navigationMock.prepareProductAppWork.mockResolvedValueOnce({
      status: 'versionIncompatible',
      slotId: 'excel-live',
      appId: 'builtin-excel-live',
      createdWithReleaseId: 'release-excel-1',
      createdWithVersion: '1.0.0',
      workDataSchemaVersion: '1',
      installedReleaseId: 'release-excel-2',
      installedVersion: '2.0.0',
      installedDataSchemaVersion: '2',
    });

    await openWork(appWork('work-incompatible', [applicationSurface]));

    expect(openMainSession).not.toHaveBeenCalled();
    expect(openProductAppRuntimeForWorkSurface).not.toHaveBeenCalled();
    expect(navigationMock.warning).toHaveBeenCalledTimes(1);
    expect(useWorkDockStore.getState().workCenterSelectedWorkId).toBe('work-incompatible');
  });
});
