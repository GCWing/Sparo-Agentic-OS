import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';
import type { ProductAppRuntimeContext } from '@/shared/types/product-app-runtime';

export interface ResolveProductAppRuntimeInstanceRequest {
  workId: string;
  productAppId: string;
  runtimeInstanceId?: string | null;
  productAppVersion?: string | null;
  componentLockDigest?: string | null;
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
  productAppId: string;
  productAppVersion: string;
  componentLockDigest: string;
  productAppSurfaceId: string;
  surfaceId: string;
  implementationRef: string;
  host: ProductAppRuntimeHost;
  runtimeContext: ProductAppRuntimeContext;
}

export type { ProductAppRuntimeContext };

export class ProductAppRuntimeAPI {
  async resolveProductAppRuntimeInstance(
    request: ResolveProductAppRuntimeInstanceRequest,
  ): Promise<ResolvedProductAppRuntimeInstance> {
    try {
      return await api.invoke('resolve_product_app_runtime_instance', { request });
    } catch (error) {
      throw createTauriCommandError('resolve_product_app_runtime_instance', error, {
        workId: request.workId,
        productAppId: request.productAppId,
        runtimeInstanceId: request.runtimeInstanceId,
      });
    }
  }
}

export const productAppRuntimeAPI = new ProductAppRuntimeAPI();
