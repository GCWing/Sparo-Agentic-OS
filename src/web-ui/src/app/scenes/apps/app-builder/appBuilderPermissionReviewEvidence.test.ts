import { describe, expect, it } from 'vitest';
import type { ProductAppCatalogEntry } from '@/infrastructure/api/service-api/AppCatalogAPI';
import type { ProductAppRuntimeContext } from '@/shared/types/product-app-runtime';
import {
  buildPermissionReviewPreviewResult,
  permissionReviewElevatedPermissionNames,
} from './appBuilderPermissionReviewEvidence';

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

describe('appBuilderPermissionReviewEvidence', () => {
  it('records explicit review evidence when no elevated permissions are declared', () => {
    const preview = buildPermissionReviewPreviewResult({
      workId: 'work-1',
      productApp: app(),
      runtimeContext,
      permissionSummary: {
        readsWorkspace: false,
        writesWorkspace: false,
        shellEnabled: false,
        netEnabled: false,
        aiEnabled: false,
        nodeEnabled: false,
      },
      observedAt: 42,
    });

    expect(preview).toMatchObject({
      id: 'preview:permission-review:runtime-1',
      kind: 'permission-review',
      status: 'passed',
      source: 'runtime-observation',
      harnessMode: 'permission-review',
      issueCount: 0,
      fatalIssueCount: 0,
      warningIssueCount: 0,
    });
    expect(preview.checks?.map((check) => [check.id, check.status])).toEqual([
      ['permissions', 'passed'],
      ['permissionManifest', 'passed'],
      ['permissionRuntimeSummary', 'passed'],
      ['permissionRiskReview', 'passed'],
      ['permissionReview', 'passed'],
    ]);
    expect(preview.detail).toContain('no elevated permission claims');
  });

  it('summarizes elevated permissions without duplicate names', () => {
    const productApp = app({ permissions: { fs: true, net: true } });
    const permissionSummary = {
      readsWorkspace: true,
      writesWorkspace: true,
      shellEnabled: false,
      netEnabled: true,
      aiEnabled: false,
      nodeEnabled: true,
    };

    expect(permissionReviewElevatedPermissionNames(productApp, permissionSummary)).toEqual([
      'fs',
      'net',
      'node',
      'workspace.read',
      'workspace.write',
    ]);

    const preview = buildPermissionReviewPreviewResult({
      workId: 'work-1',
      productApp,
      runtimeContext,
      permissionSummary,
      observedAt: 42,
    });

    expect(preview.checks?.find((check) => check.id === 'permissionReview')).toMatchObject({
      status: 'passed',
      detail: expect.stringContaining('explicit permission review'),
    });
    expect(preview.checks?.find((check) => check.id === 'permissionRiskReview')?.detail).toContain('net');
    expect(preview.checks?.find((check) => check.id === 'permissionRuntimeSummary')?.detail).toContain('node');
  });

  it('does not let package permission declarations satisfy runtime summary evidence', () => {
    const preview = buildPermissionReviewPreviewResult({
      workId: 'work-1',
      productApp: app({ permissions: { fs: true, net: true } }),
      runtimeContext,
      permissionSummary: {
        readsWorkspace: false,
        writesWorkspace: false,
        shellEnabled: false,
        netEnabled: false,
        aiEnabled: false,
        nodeEnabled: false,
      },
      observedAt: 42,
    });

    expect(preview.status).toBe('failed');
    expect(preview.detail).toContain('fs');
    expect(preview.detail).toContain('net');
    expect(preview.checks?.find((check) => check.id === 'permissionRuntimeSummary')).toMatchObject({
      status: 'failed',
      detail: expect.stringContaining('fs'),
    });
  });

  it('fails review when Runtime Host grants app-level permissions not declared by app.json', () => {
    const preview = buildPermissionReviewPreviewResult({
      workId: 'work-1',
      productApp: app(),
      runtimeContext,
      permissionSummary: {
        readsWorkspace: false,
        writesWorkspace: false,
        shellEnabled: false,
        netEnabled: true,
        aiEnabled: false,
        nodeEnabled: true,
      },
      observedAt: 42,
    });

    expect(preview.status).toBe('failed');
    expect(preview.detail).toContain('net');
    expect(preview.detail).not.toContain('node');
    expect(preview.checks?.find((check) => check.id === 'permissionRuntimeSummary')).toMatchObject({
      status: 'failed',
      detail: expect.stringContaining('Runtime Host permission claim(s) missing app.json declaration: net'),
    });
    expect(preview.checks?.find((check) => check.id === 'permissionRiskReview')).toMatchObject({
      status: 'failed',
      detail: expect.stringContaining('permission mismatch'),
    });
  });

  it('fails review when package permissions are not observed by the runtime summary', () => {
    const preview = buildPermissionReviewPreviewResult({
      workId: 'work-1',
      productApp: app({ permissions: { gui: true, secrets: true } }),
      runtimeContext,
      permissionSummary: {
        readsWorkspace: false,
        writesWorkspace: false,
        shellEnabled: false,
        netEnabled: false,
        aiEnabled: false,
        nodeEnabled: false,
      },
      observedAt: 42,
    });

    expect(preview.status).toBe('failed');
    expect(preview.fatalIssueCount).toBe(1);
    expect(preview.checks?.find((check) => check.id === 'permissionRuntimeSummary')).toMatchObject({
      status: 'failed',
      detail: expect.stringContaining('gui'),
    });
    expect(preview.checks?.find((check) => check.id === 'permissionReview')).toMatchObject({
      status: 'failed',
      detail: expect.stringContaining('missing runtime evidence'),
    });
  });
});
