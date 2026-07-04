import type { WorkspaceSurfaceContext } from '@/app/navigation/workspaceSurfaceTypes';
import type { ProductAppCatalogEntry } from '@/infrastructure/api/service-api/AppCatalogAPI';
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
}

export interface ProductAppRuntimeHostTarget {
  productApp: Pick<ProductAppCatalogEntry, 'id' | 'name' | 'version'>;
  hostSurface: ProductAppHostSurface | ProductAppHostSurfaceMeta;
  runtimeContext: ProductAppRuntimeContext;
  scope: AppScope;
  context?: WorkspaceSurfaceContext | null;
}
