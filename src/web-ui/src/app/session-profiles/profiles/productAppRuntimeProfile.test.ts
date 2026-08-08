import { describe, expect, it } from 'vitest';
import type { ProductAppRuntimeSessionMetadata } from '@/shared/types/session-history';
import { productAppRuntimeProfile } from './productAppRuntimeProfile';

const binding: ProductAppRuntimeSessionMetadata = {
  appId: 'builtin-ppt-live',
  appName: 'PPT Live',
  hostSurfaceId: 'builtin-ppt-live',
  releaseId: 'release-1',
  profile: 'product-app-runtime',
  scope: { kind: 'system' },
  runtimeContext: {
    workLocator: {
      scope: { kind: 'global' },
      workId: 'work-1',
    },
    runtimeInstanceId: 'runtime-1',
    slotId: 'slot-1',
    appId: 'builtin-ppt-live',
    releaseId: 'release-1',
    configRevision: 'config-1',
    dataSchemaVersion: '1',
    productAppSurfaceId: 'ppt-live-surface',
    surfaceId: 'primary',
    hostSurfaceId: 'builtin-ppt-live',
  },
  tabs: [
    {
      id: 'manuscript',
      type: 'product-app-runtime',
      title: 'Text draft',
      route: '/manuscript',
      sidecar: {
        actionId: 'ppt-manuscript',
        icon: 'file-text',
        order: 10,
        availability: 'enabled',
        targetGroup: 'primary',
      },
    },
  ],
};

describe('productAppRuntimeProfile', () => {
  it('maps the manuscript tab to its declared sidecar action and runtime identity', () => {
    const actions = productAppRuntimeProfile.sidecarActions?.('session-1', {
      productAppRuntime: binding,
    });

    expect(actions).toHaveLength(1);
    expect(actions?.[0]).toMatchObject({
      id: 'ppt-manuscript',
      icon: 'file-text',
      order: 10,
      availability: 'enabled',
      panel: {
        targetGroup: 'primary',
        duplicateCheckKey: 'ppt-manuscript:session-1:work-1:runtime-1',
        metadata: {
          duplicateCheckKey: 'ppt-manuscript:session-1:work-1:runtime-1',
        },
      },
    });
  });

  it('restores the same current default tab used for initialization', () => {
    const extra = { productAppRuntime: binding };

    expect(productAppRuntimeProfile.auxiliarySurface.restore?.('session-1', extra))
      .toEqual(productAppRuntimeProfile.auxiliarySurface.initialize?.('session-1', extra));
  });
});
