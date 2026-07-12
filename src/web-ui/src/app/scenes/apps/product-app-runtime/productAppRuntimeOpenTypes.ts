import type { WorkspaceSurfaceContext } from '@/app/navigation/workspaceSurfaceTypes';
import type { AppScope } from '@/shared/types/app-scope';
import type { ProductAppRuntimeContext } from '@/shared/types/product-app-runtime';
import type {
  ProductAppHostSurface,
  ProductAppHostSurfaceMeta,
} from '@/infrastructure/api/service-api/ProductAppRuntimeHostAPI';

export interface OpenProductAppRuntimeOptions {
  entityId?: string | null;
  locale?: string | null;
  workspacePath?: string | null;
  scope?: AppScope | null;
  theme?: string | null;
  context?: WorkspaceSurfaceContext | null;
  runtimeContext?: ProductAppRuntimeContext | null;
  title?: string | null;
  objective?: string | null;
  /** Navigation epoch reserved by a higher-level Work open intent. */
  navigationEpoch?: number;
  /**
   * Optional navigation intent guard for preparation paths that run before a
   * visible surface can be committed. Returning false must suppress stale UI
   * navigation while allowing already-owned cleanup to finish.
   */
  isNavigationCurrent?: () => boolean;
}

export interface ProductAppRuntimeHostTarget {
  intelligentApp: {
    appId: string;
    displayName: string;
    releaseId: string;
  };
  hostSurface: ProductAppHostSurface | ProductAppHostSurfaceMeta;
  runtimeContext: ProductAppRuntimeContext;
  scope: AppScope;
  context?: WorkspaceSurfaceContext | null;
}
