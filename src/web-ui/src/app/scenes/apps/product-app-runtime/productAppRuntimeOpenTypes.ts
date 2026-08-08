import type { WorkspaceSurfaceContext } from '@/app/navigation/workspaceSurfaceTypes';
import type { WorkLocator } from '@/app/agentic-os/work/domain/workTypes';
import type { AppScope } from '@/shared/types/app-scope';
import type { ProductAppWorkMultiplicity } from '@/shared/types/app-manifest';
import type { ProductAppRuntimeContext } from '@/shared/types/product-app-runtime';
import type {
  ProductAppHostSurface,
  ProductAppHostSurfaceMeta,
} from '@/infrastructure/api/service-api/ProductAppRuntimeHostAPI';

export interface OpenProductAppRuntimeOptions {
  /** Resume the most recent compatible Work by default; create is always explicit. */
  workMode?: 'resume' | 'create' | 'existing_object';
  /** Source Work whose primary WorkObject the new Work should share. */
  sourceWorkLocator?: WorkLocator | null;
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
    workMultiplicity: ProductAppWorkMultiplicity;
  };
  hostSurface: ProductAppHostSurface | ProductAppHostSurfaceMeta;
  runtimeContext: ProductAppRuntimeContext;
  scope: AppScope;
  context?: WorkspaceSurfaceContext | null;
}
