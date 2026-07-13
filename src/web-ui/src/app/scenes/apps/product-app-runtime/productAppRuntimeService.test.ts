import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkRecord } from '@/app/agentic-os/work/domain/workTypes';
import type { ActiveAppRef } from '@/infrastructure/api/service-api/IntelligentAppAPI';
import { openProductAppRuntime } from './productAppRuntimeService';

const mocks = vi.hoisted(() => ({
  createWork: vi.fn(),
  resolveAppWork: vi.fn(),
  requestWorkRefresh: vi.fn(),
  resolveRuntime: vi.fn(),
  getHostSurface: vi.fn(),
  openRuntimeHost: vi.fn(),
}));

vi.mock('@/app/agentic-os/work/data/workStore', () => ({
  requestWorkRefresh: mocks.requestWorkRefresh,
  useWorkStore: {
    getState: () => ({
      createWork: mocks.createWork,
      resolveAppWork: mocks.resolveAppWork,
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

function work(id: string): WorkRecord {
  return {
    id,
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
    mocks.resolveRuntime.mockImplementation(async ({ workId }: { workId: string }) => ({
      host: { kind: 'productAppRuntime', surfaceId: 'runtime-host' },
      runtimeContext: { workId },
    }));
    mocks.getHostSurface.mockResolvedValue({ id: 'runtime-host' });
    mocks.openRuntimeHost.mockResolvedValue(undefined);
  });

  it('creates a fresh Work for a multiple-work application surface', async () => {
    await openProductAppRuntime(app('multiple'));

    expect(mocks.createWork).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'app_workflow',
      subject: expect.objectContaining({ kind: 'app', intent: 'use' }),
      primarySurfacePolicy: 'application_surface',
    }));
    expect(mocks.resolveAppWork).not.toHaveBeenCalled();
    expect(mocks.resolveRuntime).toHaveBeenCalledWith(expect.objectContaining({
      workId: 'work-new',
    }));
  });

  it('resolves the existing Work for a singleton application surface', async () => {
    await openProductAppRuntime(app('singleton'));

    expect(mocks.resolveAppWork).toHaveBeenCalledWith(expect.objectContaining({
      app: expect.objectContaining({ appId: 'test-app' }),
      primarySurfacePolicy: 'application_surface',
    }));
    expect(mocks.createWork).not.toHaveBeenCalled();
    expect(mocks.resolveRuntime).toHaveBeenCalledWith(expect.objectContaining({
      workId: 'work-existing',
    }));
  });
});
