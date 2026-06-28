import type {
  ProductAppCatalogEntry,
  ProductAppLaunchScopeRequirement,
  AppWorkMultiplicity,
} from '@/infrastructure/api/service-api/AppCatalogAPI';
import type { WorkspaceInfo } from '@/shared/types';
import type { WorkScope } from './workTypes';

const DEFAULT_PRODUCT_APP_SCOPE_REQUIREMENT: ProductAppLaunchScopeRequirement = 'systemAllowed';
const DEFAULT_PRODUCT_APP_WORK_MULTIPLICITY: AppWorkMultiplicity = 'multiple';

export interface ProductAppLaunchPolicy {
  scopeRequirement: ProductAppLaunchScopeRequirement;
  requiresWorkspace: boolean;
  allowsSystemScope: boolean;
}

export class ProductAppLaunchScopeError extends Error {
  constructor(app: Pick<ProductAppCatalogEntry, 'name'>) {
    super(`${app.name} needs a project folder before it can start.`);
    this.name = 'ProductAppLaunchScopeError';
  }
}

export function getProductAppLaunchScopeRequirement(
  app: Pick<ProductAppCatalogEntry, 'launch'> | null | undefined
): ProductAppLaunchScopeRequirement {
  return app?.launch?.scopeRequirement ?? DEFAULT_PRODUCT_APP_SCOPE_REQUIREMENT;
}

export function getProductAppLaunchPolicy(
  app: Pick<ProductAppCatalogEntry, 'launch'> | null | undefined
): ProductAppLaunchPolicy {
  const scopeRequirement = getProductAppLaunchScopeRequirement(app);
  return {
    scopeRequirement,
    requiresWorkspace: scopeRequirement === 'workspaceRequired',
    allowsSystemScope: scopeRequirement !== 'workspaceRequired',
  };
}

export function productAppRequiresWorkspace(
  app: Pick<ProductAppCatalogEntry, 'launch'> | null | undefined
): boolean {
  return getProductAppLaunchPolicy(app).requiresWorkspace;
}

export function getProductAppWorkMultiplicity(
  app: Pick<ProductAppCatalogEntry, 'workMultiplicity'> | null | undefined
): AppWorkMultiplicity {
  return app?.workMultiplicity ?? DEFAULT_PRODUCT_APP_WORK_MULTIPLICITY;
}

export function productAppSupportsMultipleWorks(
  app: Pick<ProductAppCatalogEntry, 'workMultiplicity'> | null | undefined
): boolean {
  return getProductAppWorkMultiplicity(app) === 'multiple';
}

export function resolveProductAppWorkScope(
  app: Pick<ProductAppCatalogEntry, 'launch' | 'name' | 'workMultiplicity'>,
  workspace: WorkspaceInfo | null
): WorkScope {
  const policy = getProductAppLaunchPolicy(app);
  if (policy.requiresWorkspace && !workspace) {
    throw new ProductAppLaunchScopeError(app);
  }

  if (!policy.requiresWorkspace && !productAppSupportsMultipleWorks(app)) {
    return { kind: 'system' };
  }

  return workspace
    ? { kind: 'workspace', workspacePath: workspace.rootPath }
    : { kind: 'system' };
}
