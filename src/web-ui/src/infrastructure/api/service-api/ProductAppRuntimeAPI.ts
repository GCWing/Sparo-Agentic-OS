import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';
import type { ProductAppWorkMultiplicity } from '@/shared/types/app-manifest';
import type { ProductAppRuntimeContext } from '@/shared/types/product-app-runtime';
import type { WorkLocator } from '@/shared/types/work-locator';

export interface ResolveProductAppRuntimeInstanceRequest {
  locator: WorkLocator;
  slotId: string;
  appId: string;
  productAppSurfaceId?: string | null;
  surfaceId?: string | null;
}

export type ProductAppWorkCompatibilityStatus =
  | 'compatible'
  | 'appUnavailable'
  | 'appDisabled'
  | 'appSelectionChanged'
  | 'versionIncompatible';

export interface ProductAppWorkCompatibility {
  status: ProductAppWorkCompatibilityStatus;
  slotId: string;
  appId: string;
  createdWithReleaseId: string;
  createdWithVersion?: string | null;
  workDataSchemaVersion: string;
  installedAppId?: string | null;
  installedReleaseId?: string | null;
  installedVersion?: string | null;
  installedDataSchemaVersion?: string | null;
}

export interface ProductAppRuntimeHost {
  kind: 'productAppRuntime';
  surfaceId: string;
}

export interface ResolvedProductAppRuntimeInstance {
  workLocator: WorkLocator;
  runtimeInstanceId: string;
  slotId: string;
  appId: string;
  appName: string;
  workMultiplicity: ProductAppWorkMultiplicity;
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
      request.locator,
      request.slotId,
      request.appId,
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
        locator: request.locator,
        slotId: request.slotId,
        appId: request.appId,
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

  async prepareProductAppWork(locator: WorkLocator): Promise<ProductAppWorkCompatibility> {
    try {
      return await api.invoke<ProductAppWorkCompatibility>('prepare_product_app_work', {
        request: { locator },
      });
    } catch (error) {
      throw createTauriCommandError('prepare_product_app_work', error, { locator });
    }
  }
}

export const productAppRuntimeAPI = new ProductAppRuntimeAPI();
