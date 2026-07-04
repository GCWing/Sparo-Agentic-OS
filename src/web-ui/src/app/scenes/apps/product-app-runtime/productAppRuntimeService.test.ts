import { describe, expect, it } from 'vitest';
import {
  ProductAppStudioPreviewResolveError,
  isProductAppStudioPreviewResolveError,
  type ProductAppStudioPreviewFailureContext,
} from './productAppRuntimePreviewError';

describe('productAppRuntimePreviewError', () => {
  it('carries preview failure context for Work graph evidence', () => {
    const context = {
      kind: 'product-app-preview',
      stage: 'runtime-resolve',
      productApp: { id: 'app-1', version: '1.0.0', name: 'Sample App' },
      work: { id: 'work-1' },
      workContext: { kind: 'work', workId: 'work-1' },
      appRef: { kind: 'product_app', appId: 'app-1', appVersion: '1.0.0' },
      surface: {
        kind: 'application_surface',
        productAppId: 'app-1',
        productAppSurfaceId: 'surface-1',
        surfaceId: 'primary',
      },
      runtimeInstance: {
        id: 'runtime-1',
        productAppId: 'app-1',
        appVersion: '1.0.0',
        componentLockDigest: 'sha256:lock',
        productAppSurfaceId: 'surface-1',
        surfaceId: 'primary',
      },
      scope: { kind: 'system' },
    } as ProductAppStudioPreviewFailureContext;

    const error = new ProductAppStudioPreviewResolveError('Resolver failed', context);

    expect(isProductAppStudioPreviewResolveError(error)).toBe(true);
    expect(error.context.work.id).toBe('work-1');
    expect(error.context.runtimeInstance?.id).toBe('runtime-1');
    expect(error.context.surface.productAppSurfaceId).toBe('surface-1');
  });
});
