import { describe, expect, it } from 'vitest';
import type {
  AppSurfaceMode,
  AppWorkMultiplicity,
  ProductAppLaunch,
} from '@/infrastructure/api/service-api/AppCatalogAPI';
import {
  getCatalogAppLaunchBehavior,
  getProductAppLaunchBehavior,
  resolveProductAppWorkScope,
} from './productAppLaunchPolicy';

function app(overrides: {
  launch?: Partial<ProductAppLaunch> | null;
  primarySurfaceMode?: AppSurfaceMode | null;
  workMultiplicity?: AppWorkMultiplicity | null;
} = {}) {
  const launch = overrides.launch === null
    ? null
    : {
        kind: 'applicationSurface' as const,
        targetId: 'test-app',
        ...overrides.launch,
      };
  return {
    name: 'Test App',
    launch,
    primarySurfaceMode: overrides.primarySurfaceMode ?? 'chatPrimary',
    workMultiplicity: overrides.workMultiplicity,
  };
}

describe('Product App launch behavior', () => {
  it('keeps chat and sidecar apps on independent Works by default', () => {
    expect(getProductAppLaunchBehavior(app({ primarySurfaceMode: 'chatPrimary' })).workMultiplicity).toBe('multiple');
    expect(getProductAppLaunchBehavior(app({ primarySurfaceMode: 'sidecarLinked' })).workMultiplicity).toBe('multiple');
  });

  it('defaults full surface apps to singleton when multiplicity is omitted', () => {
    const behavior = getProductAppLaunchBehavior(app({ primarySurfaceMode: 'immersivePrimary' }));

    expect(behavior.supportsMultipleWorks).toBe(false);
    expect(behavior.workResolutionMode).toBe('resolveSingletonWork');
    expect(behavior.primaryActionKind).toBe('launch');
  });

  it('forces sidecar-linked preview apps to multiple even if a manifest declares singleton', () => {
    const behavior = getProductAppLaunchBehavior(app({
      primarySurfaceMode: 'sidecarLinked',
      workMultiplicity: 'singleton',
    }));

    expect(behavior.workMultiplicity).toBe('multiple');
    expect(behavior.workResolutionMode).toBe('createNewWork');
  });

  it('uses work multiplicity for native App Studio instead of launch kind', () => {
    const behavior = getCatalogAppLaunchBehavior({
      launch: {
        kind: 'appStudio',
        targetId: 'AppStudio',
      },
      primarySurfaceMode: 'chatPrimary',
      workMultiplicity: 'multiple',
    });

    expect(behavior.workResolutionMode).toBe('createNewWork');
    expect(behavior.primaryActionKind).toBe('newWork');
  });

  it('still allows full surface apps to explicitly create multiple Works', () => {
    expect(getProductAppLaunchBehavior(app({
      primarySurfaceMode: 'immersivePrimary',
      workMultiplicity: 'multiple',
    })).supportsMultipleWorks).toBe(true);
  });

  it('keeps singleton system-allowed apps in system scope', () => {
    expect(resolveProductAppWorkScope(app({
      primarySurfaceMode: 'immersivePrimary',
      workMultiplicity: 'singleton',
    }), null)).toEqual({ kind: 'system' });
  });

  it('requires a workspace when launch policy says workspaceRequired', () => {
    expect(() => resolveProductAppWorkScope(app({
      launch: { scopeRequirement: 'workspaceRequired' },
    }), null)).toThrow('needs a project folder');
  });
});
