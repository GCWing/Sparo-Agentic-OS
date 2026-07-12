import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';
import type { ProductAppRuntimeContext } from '@/shared/types/product-app-runtime';

export interface ResolveProductAppRuntimeInstanceRequest {
  workId: string;
  slotId: string;
  appId: string;
  releaseId: string;
  configRevision: string;
  dataSchemaVersion: string;
  runtimeInstanceId?: string | null;
  productAppSurfaceId?: string | null;
  surfaceId?: string | null;
}

export interface ProductAppRuntimeHost {
  kind: 'productAppRuntime';
  surfaceId: string;
}

export interface ResolvedProductAppRuntimeInstance {
  workId: string;
  runtimeInstanceId: string;
  slotId: string;
  appId: string;
  releaseId: string;
  configRevision: string;
  dataSchemaVersion: string;
  productAppSurfaceId: string;
  surfaceId: string;
  implementationRef: string;
  host: ProductAppRuntimeHost;
  runtimeContext: ProductAppRuntimeContext;
}

export type { ProductAppRuntimeContext };

export class ProductAppRuntimeAPI {
  private readonly pendingResolutions = new Map<
    string,
    Promise<ResolvedProductAppRuntimeInstance>
  >();

  private resolutionKey(request: ResolveProductAppRuntimeInstanceRequest): string {
    return JSON.stringify([
      request.workId,
      request.slotId,
      request.appId,
      request.releaseId,
      request.configRevision,
      request.dataSchemaVersion,
      request.runtimeInstanceId ?? null,
      request.productAppSurfaceId ?? null,
      request.surfaceId ?? null,
    ]);
  }

  async resolveProductAppRuntimeInstance(
    request: ResolveProductAppRuntimeInstanceRequest,
  ): Promise<ResolvedProductAppRuntimeInstance> {
    const key = this.resolutionKey(request);
    const existing = this.pendingResolutions.get(key);
    if (existing) {
      return existing;
    }

    const pending = api.invoke<ResolvedProductAppRuntimeInstance>(
      'resolve_product_app_runtime_instance',
      { request },
    ).catch((error) => {
      throw createTauriCommandError('resolve_product_app_runtime_instance', error, {
        workId: request.workId,
        slotId: request.slotId,
        appId: request.appId,
        releaseId: request.releaseId,
        configRevision: request.configRevision,
        runtimeInstanceId: request.runtimeInstanceId,
      });
    });
    this.pendingResolutions.set(key, pending);

    try {
      return await pending;
    } finally {
      if (this.pendingResolutions.get(key) === pending) {
        this.pendingResolutions.delete(key);
      }
    }
  }
}

export const productAppRuntimeAPI = new ProductAppRuntimeAPI();
