import { describe, expect, it } from 'vitest';
import type { ProductAppCatalogEntry } from '@/infrastructure/api/service-api/AppCatalogAPI';
import type { ProductAppRuntimeContext } from '@/shared/types/product-app-runtime';
import type { ProductAppHostSurface } from '@/infrastructure/api/service-api/ProductAppRuntimeHostAPI';
import type { ProductAppRuntimeHostSummary } from '../product-app-runtime/productAppRuntimeHostModel';
import {
  buildRuntimeDependencyPreviewResult,
  type RuntimeDependencyReadyEvidence,
} from './appStudioRuntimeDependencyEvidence';

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

const productApp = {
  id: 'app-1',
  version: '1.0.0',
  name: 'App One',
  description: 'Test app',
  goal: 'Test the app',
  interactionModel: 'interactiveWorkspace',
  primarySurface: { componentId: 'surface-1', surfaceId: 'primary' },
  primarySurfaceMode: 'immersivePrimary',
  components: [],
  componentLockId: 'lock',
  componentLockDigest: 'sha256:lock',
  permissions: {},
  installScope: 'project',
  catalogVisibility: 'installedOnly',
  enabled: true,
} as ProductAppCatalogEntry;

function surface(overrides: Partial<ProductAppHostSurface> = {}): ProductAppHostSurface {
  return {
    id: 'surface-1',
    name: 'Surface',
    description: 'Surface',
    source: {
      files: [],
      npm_dependencies: [],
      esm_dependencies: [],
    },
    permissions: {},
    runtime: {
      source_revision: 'rev-1',
      deps_revision: 'deps-1',
      deps_dirty: false,
      worker_restart_required: false,
    },
    created_at: 1,
    updated_at: 1,
    ...overrides,
  } as ProductAppHostSurface;
}

function summary(overrides: Partial<ProductAppRuntimeHostSummary> = {}): ProductAppRuntimeHostSummary {
  return {
    isOpen: false,
    isRunning: false,
    depsDirty: false,
    workerRestartRequired: false,
    runtimeAvailable: true,
    nodeEnabled: true,
    runtimeLabel: 'node 22',
    hasAttention: false,
    ...overrides,
  };
}

function ready(overrides: Partial<RuntimeDependencyReadyEvidence> = {}): RuntimeDependencyReadyEvidence {
  return {
    hostSurfaceId: 'surface-1',
    sourceRevision: 'rev-1',
    depsRevision: 'deps-1',
    depsDirty: false,
    workerRestartRequired: false,
    timestampMs: 42,
    metrics: {
      bodyChildCount: 1,
      visibleElementCount: 1,
    },
    ...overrides,
  };
}

function build(
  runtimeSummary: ProductAppRuntimeHostSummary,
  hostSurface: ProductAppHostSurface = surface(),
  runtimeReady?: RuntimeDependencyReadyEvidence | null,
) {
  return buildRuntimeDependencyPreviewResult({
    workId: 'work-1',
    productApp,
    runtimeContext,
    productAppSurfaceId: 'surface-1',
    surfaceId: 'primary',
    hostSurface,
    runtimeSummary,
    runtimeReady,
    observedAt: 42,
  });
}

describe('appStudioRuntimeDependencyEvidence', () => {
  it('waits for a current runtime-ready handshake when runtime dependency metadata is current', () => {
    const preview = build(summary(), surface({
      source: {
        files: [],
        npm_dependencies: [{ name: 'zod', version: '^3.0.0' }],
        esm_dependencies: [],
      },
    }));

    expect(preview).toMatchObject({
      id: 'preview:runtime-dependencies:runtime-1',
      kind: 'runtime-dependencies',
      status: 'notVerified',
      source: 'runtime-observation',
      harnessMode: 'runtime-dependencies',
      issueCount: 0,
    });
    expect(preview.checks).toEqual([
      expect.objectContaining({
        id: 'runtimeDependencies',
        status: 'notVerified',
        detail: expect.stringContaining('No current iframe runtime-ready handshake'),
      }),
    ]);
  });

  it('passes only when the current host revision is loaded and the node worker is fresh', () => {
    const preview = build(summary({ isRunning: true }), surface({
      source: {
        files: [],
        npm_dependencies: [{ name: 'zod', version: '^3.0.0' }],
        esm_dependencies: [],
      },
    }), ready());

    expect(preview).toMatchObject({
      status: 'passed',
      issueCount: 0,
      fatalIssueCount: 0,
      warningIssueCount: 0,
    });
    expect(preview.checks?.[0]).toMatchObject({
      id: 'runtimeDependencies',
      status: 'passed',
      detail: expect.stringContaining('loaded source revision rev-1'),
    });
  });

  it('waits when the runtime-ready handshake is stale', () => {
    const preview = build(summary({ isRunning: true }), surface(), ready({
      sourceRevision: 'rev-older',
    }));

    expect(preview.status).toBe('notVerified');
    expect(preview.checks?.[0]).toMatchObject({
      id: 'runtimeDependencies',
      status: 'notVerified',
      detail: expect.stringContaining('does not match current host source revision rev-1'),
    });
  });

  it('waits when the runtime-ready handshake belongs to a different host surface', () => {
    const preview = build(summary({ isRunning: true }), surface(), ready({
      hostSurfaceId: 'surface-other',
    }));

    expect(preview.status).toBe('notVerified');
    expect(preview.checks?.[0]).toMatchObject({
      id: 'runtimeDependencies',
      status: 'notVerified',
      detail: expect.stringContaining('does not match current Product App Runtime host surface surface-1'),
    });
  });

  it('waits when the compiled runtime-ready adapter reports dirty dependencies or stale worker state', () => {
    expect(build(summary({ isRunning: true }), surface(), ready({ depsDirty: true })).checks?.[0]).toMatchObject({
      id: 'runtimeDependencies',
      status: 'notVerified',
      detail: expect.stringContaining('dependency state dirty'),
    });
    expect(build(summary({ isRunning: true }), surface(), ready({ workerRestartRequired: true })).checks?.[0]).toMatchObject({
      id: 'runtimeDependencies',
      status: 'notVerified',
      detail: expect.stringContaining('worker restart state required'),
    });
  });

  it('waits for runtime-ready metrics when browser ESM dependencies are declared', () => {
    const preview = build(summary(), surface({
      source: {
        files: [],
        npm_dependencies: [{ name: 'zod', version: '^3.0.0' }],
        esm_dependencies: [{ name: 'react', version: '18', url: 'https://esm.sh/react@18' }],
      },
    }));

    expect(preview.status).toBe('notVerified');
    expect(preview.checks?.[0]).toMatchObject({
      id: 'runtimeDependencies',
      status: 'notVerified',
      detail: expect.stringContaining('No current iframe runtime-ready handshake'),
    });
  });

  it('waits for positive runtime-ready DOM metrics when browser ESM dependencies are declared', () => {
    const preview = build(summary({ isRunning: true }), surface({
      source: {
        files: [],
        npm_dependencies: [],
        esm_dependencies: [{ name: 'react', version: '18', url: 'https://esm.sh/react@18' }],
      },
    }), ready({
      metrics: {
        bodyChildCount: 0,
        visibleElementCount: 0,
      },
    }));

    expect(preview.status).toBe('notVerified');
    expect(preview.checks?.[0]).toMatchObject({
      id: 'runtimeDependencies',
      status: 'notVerified',
      detail: expect.stringContaining('positive DOM metrics'),
    });
  });

  it('waits when dependencies are dirty or the worker must restart', () => {
    expect(build(summary({ depsDirty: true, isRunning: true }), surface(), ready()).checks?.[0]).toMatchObject({
      id: 'runtimeDependencies',
      status: 'notVerified',
      detail: expect.stringContaining('not installed'),
    });
    expect(build(summary({ workerRestartRequired: true, isRunning: true }), surface(), ready()).checks?.[0]).toMatchObject({
      id: 'runtimeDependencies',
      status: 'notVerified',
      detail: expect.stringContaining('Worker restart'),
    });
  });

  it('fails when node runtime is required but unavailable', () => {
    const preview = build(summary({ runtimeAvailable: false, runtimeLabel: '' }));

    expect(preview.status).toBe('failed');
    expect(preview.fatalIssueCount).toBe(1);
    expect(preview.checks?.[0]).toMatchObject({
      id: 'runtimeDependencies',
      status: 'failed',
      detail: expect.stringContaining('no local JavaScript runtime'),
    });
  });

  it('waits for source loading evidence when no node worker runtime or runtime dependencies are declared', () => {
    const preview = build(summary({ nodeEnabled: false, runtimeAvailable: false, runtimeLabel: '' }));

    expect(preview.status).toBe('notVerified');
    expect(preview.checks?.[0]).toMatchObject({
      id: 'runtimeDependencies',
      status: 'notVerified',
      detail: expect.stringContaining('No current iframe runtime-ready handshake'),
    });
  });

  it('passes source loading evidence for a non-node runtime after a current ready handshake', () => {
    const preview = build(
      summary({ nodeEnabled: false, runtimeAvailable: false, runtimeLabel: '' }),
      surface(),
      ready(),
    );

    expect(preview.status).toBe('passed');
    expect(preview.checks?.[0]).toMatchObject({
      id: 'runtimeDependencies',
      status: 'passed',
      detail: expect.stringContaining('dependency revision deps-1'),
    });
  });

  it('waits for runtime host evidence when browser ESM dependencies exist without a node worker', () => {
    const preview = build(summary({ nodeEnabled: false, runtimeAvailable: false, runtimeLabel: '' }), surface({
      source: {
        files: [],
        npm_dependencies: [],
        esm_dependencies: [{ name: 'react', version: '18', url: 'https://esm.sh/react@18' }],
      },
    }));

    expect(preview.status).toBe('notVerified');
    expect(preview.checks?.[0]).toMatchObject({
      id: 'runtimeDependencies',
      status: 'notVerified',
      detail: expect.stringContaining('No current iframe runtime-ready handshake'),
    });
  });
});
