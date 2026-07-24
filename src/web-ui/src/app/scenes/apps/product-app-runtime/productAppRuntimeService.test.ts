import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkRecord } from '@/app/agentic-os/work/domain/workTypes';
import type { ActiveAppRef } from '@/infrastructure/api/service-api/IntelligentAppAPI';
import { openProductAppRuntime } from './productAppRuntimeService';

const mocks = vi.hoisted(() => ({
  createWork: vi.fn(),
  resolveAppWork: vi.fn(),
  deleteWork: vi.fn(),
  requestWorkRefresh: vi.fn(),
  resolveRuntime: vi.fn(),
  getHostSurface: vi.fn(),
  backendCall: vi.fn(),
  openRuntimeHost: vi.fn(),
}));

vi.mock('@/app/agentic-os/work/data/workStore', () => ({
  requestWorkRefresh: mocks.requestWorkRefresh,
  useWorkStore: {
    getState: () => ({
      createWork: mocks.createWork,
      resolveAppWork: mocks.resolveAppWork,
      deleteWork: mocks.deleteWork,
    }),
  },
}));

vi.mock('@/infrastructure/api/service-api/ProductAppRuntimeAPI', () => ({
  productAppRuntimeAPI: {
    resolveProductAppRuntimeInstance: mocks.resolveRuntime,
  },
}));

vi.mock('@/infrastructure/api/service-api/ProductAppRuntimeHostAPI', () => ({
  productAppRuntimeHostAPI: {
    getHostSurface: mocks.getHostSurface,
    backendCall: mocks.backendCall,
  },
}));

vi.mock('./productAppRuntimeHostService', () => ({
  openProductAppRuntimeHost: mocks.openRuntimeHost,
}));

function app(workMultiplicity: 'multiple' | 'singleton'): ActiveAppRef {
  return {
    slotId: 'test-slot',
    appId: 'test-app',
    releaseId: 'release-1',
    configRevision: 'config-1',
    dataSchemaVersion: '1',
    runtime: {
      launch: {
        kind: 'applicationSurface',
        targetId: 'test-app',
        scopeRequirement: 'systemAllowed',
      },
      primarySurface: {
        componentId: 'test-surface',
        surfaceId: 'primary',
      },
      primarySurfaceMode: 'immersivePrimary',
      workMultiplicity,
      icon: { kind: 'builtin', name: 'test' },
      category: 'test',
      tags: [],
    },
  };
}

function work(
  id: string,
  scope: WorkRecord['scope'] = { kind: 'global' },
  workspacePath?: string,
): WorkRecord {
  return {
    id,
    title: 'Test presentation',
    scope,
    workspacePath,
    primarySurface: {
      kind: 'application_surface',
      productAppId: 'test-app',
      productAppSurfaceId: 'test-surface',
      surfaceId: 'primary',
    },
    surfaces: [],
  } as unknown as WorkRecord;
}

describe('openProductAppRuntime work multiplicity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createWork.mockResolvedValue(work('work-new'));
    mocks.resolveAppWork.mockResolvedValue({ work: work('work-existing'), created: false });
    mocks.deleteWork.mockResolvedValue({ deleted: true });
    mocks.resolveRuntime.mockImplementation(async ({ locator }) => ({
      appId: 'test-app',
      appName: 'Test App',
      releaseId: 'release-1',
      workMultiplicity: 'multiple',
      host: { kind: 'productAppRuntime', surfaceId: 'runtime-host' },
      runtimeContext: { workLocator: locator },
    }));
    mocks.getHostSurface.mockResolvedValue({ id: 'runtime-host' });
    mocks.backendCall.mockResolvedValue({ status: 'completed' });
    mocks.openRuntimeHost.mockResolvedValue(undefined);
  });

  it('resumes the most recent Work by default for a multiple-work application surface', async () => {
    await openProductAppRuntime(app('multiple'));

    expect(mocks.resolveAppWork).toHaveBeenCalledWith(expect.objectContaining({
      app: expect.objectContaining({ appId: 'test-app' }),
      primarySurfacePolicy: 'application_surface',
    }));
    expect(mocks.createWork).not.toHaveBeenCalled();
    expect(mocks.resolveRuntime).toHaveBeenCalledWith(expect.objectContaining({
      locator: {
        scope: { kind: 'global' },
        workId: 'work-existing',
      },
    }));
    expect(mocks.openRuntimeHost).toHaveBeenCalledWith(expect.objectContaining({
      intelligentApp: {
        appId: 'test-app',
        displayName: 'Test App',
        releaseId: 'release-1',
        workMultiplicity: 'multiple',
      },
    }), expect.anything());
  });

  it('creates a fresh Work only when a multiple-work launch is explicit', async () => {
    await openProductAppRuntime(app('multiple'), { workMode: 'create' });

    expect(mocks.createWork).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'app_workflow',
      subject: expect.objectContaining({ kind: 'app', intent: 'use' }),
      primarySurfacePolicy: 'application_surface',
    }));
    expect(mocks.resolveAppWork).not.toHaveBeenCalled();
    expect(mocks.resolveRuntime).toHaveBeenCalledWith(expect.objectContaining({
      locator: {
        scope: { kind: 'global' },
        workId: 'work-new',
      },
    }));
  });

  it('initializes declared Work storage before opening a newly created runtime', async () => {
    mocks.getHostSurface.mockResolvedValue({
      id: 'runtime-host',
      backends: [{
        id: 'deck-engine',
        role: 'deckEngine',
        actions: [{ name: 'initializeWork' }],
      }],
    });
    mocks.createWork.mockResolvedValueOnce(work(
      'work-new',
      { kind: 'workspace', workspaceId: 'ws_project' },
      'D:/workspace/project',
    ));

    await openProductAppRuntime(app('multiple'), {
      workMode: 'create',
      title: 'Activation Review',
      scope: {
        kind: 'workspace',
        workspaceId: 'ws_project',
        workspacePath: 'D:/workspace/project',
      },
    });

    expect(mocks.backendCall).toHaveBeenCalledWith(
      'runtime-host',
      'deckEngine.initializeWork',
      { title: 'Test presentation' },
      expect.objectContaining({
        workspacePath: 'D:/workspace/project',
        idempotencyKey: 'initialize-work-work-new-deck-engine',
      }),
    );
    expect(mocks.openRuntimeHost).toHaveBeenCalledAfter(mocks.backendCall);
  });

  it('resolves the existing Work for a singleton application surface', async () => {
    await openProductAppRuntime(app('singleton'));

    expect(mocks.resolveAppWork).toHaveBeenCalledWith(expect.objectContaining({
      app: expect.objectContaining({ appId: 'test-app' }),
      primarySurfacePolicy: 'application_surface',
    }));
    expect(mocks.createWork).not.toHaveBeenCalled();
    expect(mocks.resolveRuntime).toHaveBeenCalledWith(expect.objectContaining({
      locator: {
        scope: { kind: 'global' },
        workId: 'work-existing',
      },
    }));
  });

  it('rolls back a newly created Work when the Product App cannot open completely', async () => {
    const createdWork = work(
      'work-incomplete',
      { kind: 'workspace', workspaceId: 'ws_project' },
      'D:/workspace/project',
    );
    mocks.resolveAppWork.mockResolvedValueOnce({ work: createdWork, created: true });
    mocks.openRuntimeHost.mockRejectedValueOnce(
      new Error('Product App session contract violation'),
    );

    await expect(openProductAppRuntime(app('multiple'), {
      scope: {
        kind: 'workspace',
        workspaceId: 'ws_project',
        workspacePath: 'D:/workspace/project',
      },
    })).rejects.toThrow('Product App session contract violation');

    expect(mocks.deleteWork).toHaveBeenCalledWith(
      {
        scope: { kind: 'workspace', workspaceId: 'ws_project' },
        workId: 'work-incomplete',
      },
      { deleteLinkedSessions: true },
    );
  });
});
