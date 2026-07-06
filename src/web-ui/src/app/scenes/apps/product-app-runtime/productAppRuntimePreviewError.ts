import type { ProductAppCatalogEntry } from '@/infrastructure/api/service-api/AppCatalogAPI';
import type {
  RuntimeInstanceRef,
  WorkAppRef,
  WorkRecord,
  WorkSurfaceRef,
} from '@/app/agentic-os/work/domain/workTypes';
import type { AppScope } from '@/shared/types/app-scope';
import type { WorkspaceSurfaceContext } from '@/app/navigation/workspaceSurfaceTypes';
import type { ResolvedProductAppRuntimeInstance } from '@/infrastructure/api/service-api/ProductAppRuntimeAPI';

export interface ProductAppBuilderPreviewFailureContext {
  kind: 'product-app-preview';
  stage: 'runtime-resolve' | 'host-surface-load';
  productApp: ProductAppCatalogEntry;
  work: WorkRecord;
  workContext: WorkspaceSurfaceContext;
  appRef: WorkAppRef | null;
  surface: Extract<WorkSurfaceRef, { kind: 'application_surface' }>;
  runtimeInstance: RuntimeInstanceRef | null;
  resolvedRuntime?: ResolvedProductAppRuntimeInstance;
  scope: AppScope;
  workspacePath?: string;
}

export class ProductAppBuilderPreviewResolveError extends Error {
  readonly context: ProductAppBuilderPreviewFailureContext;

  constructor(message: string, context: ProductAppBuilderPreviewFailureContext, cause?: unknown) {
    super(message);
    this.name = 'ProductAppBuilderPreviewResolveError';
    this.context = context;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

export function isProductAppBuilderPreviewResolveError(
  error: unknown,
): error is ProductAppBuilderPreviewResolveError {
  return error instanceof ProductAppBuilderPreviewResolveError;
}
