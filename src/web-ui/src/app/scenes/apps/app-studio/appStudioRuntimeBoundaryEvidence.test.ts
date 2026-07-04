import { describe, expect, it } from 'vitest';
import type { ProductAppCatalogEntry } from '@/infrastructure/api/service-api/AppCatalogAPI';
import type { ProductAppRuntimeContext } from '@/shared/types/product-app-runtime';
import { buildRuntimeBoundaryPreviewResult } from './appStudioRuntimeBoundaryEvidence';

const runtimeContext: ProductAppRuntimeContext = {
  workId: 'work-1',
  runtimeInstanceId: 'runtime-1',
  productAppId: 'app-1',
  productAppVersion: '1.0.0',
  componentLockDigest: 'sha256:lock',
  productAppSurfaceId: 'surface-1',
  surfaceId: 'primary',
  hostSurfaceId: 'host-surface-1',
};

function app(overrides: Partial<ProductAppCatalogEntry> = {}): ProductAppCatalogEntry {
  return {
    id: 'app-1',
    version: '1.0.0',
    name: 'App One',
    description: 'Test app',
    goal: 'Test the app',
    interactionModel: 'interactiveWorkspace',
    workObjectKinds: [{ id: 'note', label: 'Note', scope: 'runtime' }],
    primarySurface: { componentId: 'surface-1', surfaceId: 'primary' },
    primarySurfaceMode: 'immersivePrimary',
    components: [],
    componentLockId: 'lock',
    componentLockDigest: 'sha256:lock',
    permissions: {},
    installScope: 'project',
    catalogVisibility: 'installedOnly',
    enabled: true,
    ...overrides,
  } as ProductAppCatalogEntry;
}

describe('appStudioRuntimeBoundaryEvidence', () => {
  it('records storage evidence but waits for data behavior and lifecycle execution evidence', () => {
    const preview = buildRuntimeBoundaryPreviewResult({
      workId: 'work-1',
      productApp: app({
        dataLifecycle: {
          retention: 'workRuntimeScoped',
          deletion: 'deleteWithWork',
          migration: 'notSupported',
          share: 'excludeRuntimePrivateData',
        },
      }),
      runtimeContext,
      productAppSurfaceId: 'surface-1',
      surfaceId: 'primary',
      permissionSummary: {
        readsWorkspace: false,
        writesWorkspace: false,
        shellEnabled: false,
        netEnabled: false,
        aiEnabled: false,
        nodeEnabled: false,
      },
      storageProbe: { status: 'passed', scope: 'work-runtime' },
      observedAt: 42,
    });

    expect(preview).toMatchObject({
      id: 'preview:runtime-boundary:runtime-1',
      kind: 'runtime-boundary',
      status: 'notVerified',
      source: 'runtime-observation',
      harnessMode: 'runtime-boundary',
      issueCount: 0,
      fatalIssueCount: 0,
      warningIssueCount: 0,
    });
    expect(preview.checks?.map((check) => [check.id, check.status])).toEqual([
      ['runtimeStorage', 'passed'],
      ['permissions', 'passed'],
      ['data', 'notVerified'],
      ['dataLifecycle', 'notVerified'],
      ['dataSummary', 'notVerified'],
    ]);
    expect(preview.checks?.[0]?.detail).not.toContain(':\\');
    expect(preview.checks?.find((check) => check.id === 'data')?.detail).toContain('has not been executed or recorded');
    expect(preview.checks?.find((check) => check.id === 'dataLifecycle')?.detail).toContain('retention=workRuntimeScoped');
    expect(preview.checks?.find((check) => check.id === 'dataLifecycle')?.detail).not.toContain('policy is declared');
    expect(preview.checks?.find((check) => check.id === 'dataSummary')?.detail).toContain('isolated runtime write/read/delete behavior');
  });

  it('passes data readiness after isolated runtime storage write/read/delete evidence', () => {
    const preview = buildRuntimeBoundaryPreviewResult({
      workId: 'work-1',
      productApp: app({
        dataLifecycle: {
          retention: 'workRuntimeScoped',
          deletion: 'deleteWithWork',
          migration: 'notSupported',
          share: 'excludeRuntimePrivateData',
        },
      }),
      runtimeContext,
      productAppSurfaceId: 'surface-1',
      surfaceId: 'primary',
      permissionSummary: {
        readsWorkspace: false,
        writesWorkspace: false,
        shellEnabled: false,
        netEnabled: false,
        aiEnabled: false,
        nodeEnabled: false,
      },
      storageProbe: { status: 'passed', scope: 'work-runtime' },
      dataProbe: {
        status: 'passed',
        scope: 'work-runtime',
        probeKey: '__sparo_readiness_probe__',
        writeVerified: true,
        readVerified: true,
        deleteVerified: true,
      },
      observedAt: 42,
    });

    expect(preview.status).toBe('passed');
    expect(preview.checks?.map((check) => [check.id, check.status])).toEqual([
      ['runtimeStorage', 'passed'],
      ['permissions', 'passed'],
      ['data', 'passed'],
      ['dataLifecycle', 'passed'],
      ['dataSummary', 'passed'],
    ]);
    expect(preview.checks?.find((check) => check.id === 'data')?.detail).toContain('write/read/delete');
    expect(preview.checks?.find((check) => check.id === 'dataSummary')?.detail).toContain('excludeRuntimePrivateData');
  });

  it('keeps elevated permissions as review warnings instead of marking them clean', () => {
    const preview = buildRuntimeBoundaryPreviewResult({
      workId: 'work-1',
      productApp: app({ permissions: { net: true } }),
      runtimeContext,
      productAppSurfaceId: 'surface-1',
      surfaceId: 'primary',
      permissionSummary: {
        readsWorkspace: false,
        writesWorkspace: false,
        shellEnabled: false,
        netEnabled: true,
        aiEnabled: false,
        nodeEnabled: true,
      },
      storageProbe: { status: 'passed', scope: 'work-runtime' },
      observedAt: 42,
    });

    expect(preview.status).toBe('warning');
    expect(preview.warningIssueCount).toBe(1);
    expect(preview.checks?.find((check) => check.id === 'permissions')).toMatchObject({
      status: 'warning',
      detail: expect.stringContaining('net'),
    });
  });

  it('does not pass data readiness when the package has no declared data boundary', () => {
    const preview = buildRuntimeBoundaryPreviewResult({
      workId: 'work-1',
      productApp: app({ workObjectKinds: [] }),
      runtimeContext,
      productAppSurfaceId: 'surface-1',
      surfaceId: 'primary',
      permissionSummary: null,
      storageProbe: { status: 'passed', scope: 'work-runtime' },
      observedAt: 42,
    });

    expect(preview.status).toBe('notVerified');
    expect(preview.issueCount).toBe(0);
    expect(preview.checks?.find((check) => check.id === 'data')).toMatchObject({
      status: 'notVerified',
      detail: expect.stringContaining('no declared work object data boundary'),
    });
    expect(preview.checks?.find((check) => check.id === 'dataLifecycle')).toMatchObject({
      status: 'notVerified',
      detail: expect.stringContaining('runtime retention'),
    });
    expect(preview.checks?.find((check) => check.id === 'dataSummary')).toMatchObject({
      status: 'notVerified',
      detail: expect.stringContaining('declares at least one work object'),
    });
  });

  it('fails permission and data evidence when storage scope probing fails', () => {
    const preview = buildRuntimeBoundaryPreviewResult({
      workId: 'work-1',
      productApp: app(),
      runtimeContext,
      productAppSurfaceId: 'surface-1',
      surfaceId: 'primary',
      permissionSummary: null,
      storageProbe: { status: 'failed', error: 'runtime context mismatch' },
      observedAt: 42,
    });

    expect(preview.status).toBe('failed');
    expect(preview.fatalIssueCount).toBe(5);
    expect(preview.checks?.map((check) => [check.id, check.status])).toEqual([
      ['runtimeStorage', 'failed'],
      ['permissions', 'failed'],
      ['data', 'failed'],
      ['dataLifecycle', 'failed'],
      ['dataSummary', 'failed'],
    ]);
  });
});
