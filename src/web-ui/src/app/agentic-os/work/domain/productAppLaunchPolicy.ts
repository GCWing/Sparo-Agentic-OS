import type {
  NativeAppCatalogEntry,
  ProductAppCatalogEntry,
  ProductAppLaunch,
  ProductAppLaunchScopeRequirement,
  AppWorkMultiplicity,
  AppSurfaceMode,
} from '@/infrastructure/api/service-api/AppCatalogAPI';
import type { WorkspaceInfo } from '@/shared/types';
import type { WorkScope } from './workTypes';

const DEFAULT_PRODUCT_APP_SCOPE_REQUIREMENT: ProductAppLaunchScopeRequirement = 'systemAllowed';
const DEFAULT_PRODUCT_APP_WORK_MULTIPLICITY: AppWorkMultiplicity = 'multiple';

type ProductAppLaunchPolicyInput = {
  launch?: Pick<ProductAppLaunch, 'scopeRequirement'> | null;
};

type ProductAppMultiplicityInput = {
  workMultiplicity?: AppWorkMultiplicity | null;
  primarySurfaceMode?: AppSurfaceMode | null;
};

type ProductAppLaunchBehaviorInput = ProductAppLaunchPolicyInput & ProductAppMultiplicityInput;
type CatalogAppLaunchBehaviorInput = ProductAppLaunchBehaviorInput;

export type ProductAppWorkResolutionMode = 'createNewWork' | 'resolveSingletonWork';
export type ProductAppPrimaryActionKind = 'newWork' | 'launch';

export interface ProductAppLaunchPolicy {
  scopeRequirement: ProductAppLaunchScopeRequirement;
  requiresWorkspace: boolean;
  allowsSystemScope: boolean;
}

export interface ProductAppLaunchBehavior extends ProductAppLaunchPolicy {
  workMultiplicity: AppWorkMultiplicity;
  supportsMultipleWorks: boolean;
  workResolutionMode: ProductAppWorkResolutionMode;
  primaryActionKind: ProductAppPrimaryActionKind;
}

export class ProductAppLaunchScopeError extends Error {
  constructor(app: Pick<ProductAppCatalogEntry, 'name'>) {
    super(`${app.name} needs a project folder before it can start.`);
    this.name = 'ProductAppLaunchScopeError';
  }
}

export function getProductAppLaunchScopeRequirement(
  app: ProductAppLaunchPolicyInput | null | undefined
): ProductAppLaunchScopeRequirement {
  return app?.launch?.scopeRequirement ?? DEFAULT_PRODUCT_APP_SCOPE_REQUIREMENT;
}

export function getProductAppLaunchPolicy(
  app: ProductAppLaunchPolicyInput | null | undefined
): ProductAppLaunchPolicy {
  const scopeRequirement = getProductAppLaunchScopeRequirement(app);
  return {
    scopeRequirement,
    requiresWorkspace: scopeRequirement === 'workspaceRequired',
    allowsSystemScope: scopeRequirement !== 'workspaceRequired',
  };
}

export function productAppRequiresWorkspace(
  app: ProductAppLaunchPolicyInput | null | undefined
): boolean {
  return getProductAppLaunchPolicy(app).requiresWorkspace;
}

export function catalogAppRequiresWorkspace(
  app: ProductAppLaunchPolicyInput | null | undefined
): boolean {
  return getProductAppLaunchPolicy(app).requiresWorkspace;
}

export function getProductAppWorkMultiplicity(
  app: ProductAppMultiplicityInput | null | undefined
): AppWorkMultiplicity {
  if (app?.primarySurfaceMode === 'sidecarLinked') {
    return 'multiple';
  }
  if (app?.workMultiplicity) {
    return app.workMultiplicity;
  }
  if (app?.primarySurfaceMode === 'immersivePrimary' || app?.primarySurfaceMode === 'embeddedObject') {
    return 'singleton';
  }
  return DEFAULT_PRODUCT_APP_WORK_MULTIPLICITY;
}

export function productAppSupportsMultipleWorks(
  app: ProductAppMultiplicityInput | null | undefined
): boolean {
  return getProductAppWorkMultiplicity(app) === 'multiple';
}

export function catalogAppSupportsMultipleWorks(
  app: ProductAppMultiplicityInput | null | undefined
): boolean {
  return getProductAppWorkMultiplicity(app) === 'multiple';
}

export function getCatalogAppLaunchBehavior(
  app: CatalogAppLaunchBehaviorInput | null | undefined
): ProductAppLaunchBehavior {
  const launchPolicy = getProductAppLaunchPolicy(app);
  const workMultiplicity = getProductAppWorkMultiplicity(app);
  const supportsMultipleWorks = workMultiplicity === 'multiple';
  return {
    ...launchPolicy,
    workMultiplicity,
    supportsMultipleWorks,
    workResolutionMode: supportsMultipleWorks ? 'createNewWork' : 'resolveSingletonWork',
    primaryActionKind: supportsMultipleWorks ? 'newWork' : 'launch',
  };
}

export function getProductAppLaunchBehavior(
  app: ProductAppLaunchBehaviorInput | null | undefined
): ProductAppLaunchBehavior {
  return getCatalogAppLaunchBehavior(app);
}

/** Only a global singleton can launch without confirming a new Work scope. */
export function catalogAppLaunchRequiresWorkConfirmation(
  app: CatalogAppLaunchBehaviorInput | null | undefined
): boolean {
  const behavior = getCatalogAppLaunchBehavior(app);
  return behavior.supportsMultipleWorks || behavior.requiresWorkspace;
}

export function getNativeAppLaunchBehavior(
  app: Pick<NativeAppCatalogEntry, 'launch' | 'workMultiplicity' | 'primarySurfaceMode'> | null | undefined
): ProductAppLaunchBehavior {
  return getCatalogAppLaunchBehavior(app);
}

export function productAppResolvesSingletonWork(
  app: ProductAppMultiplicityInput | null | undefined
): boolean {
  return getProductAppWorkMultiplicity(app) === 'singleton';
}

export function resolveProductAppWorkScope(
  app: ProductAppLaunchBehaviorInput & Pick<ProductAppCatalogEntry, 'name'>,
  workspace: WorkspaceInfo | null
): WorkScope {
  const policy = getProductAppLaunchPolicy(app);
  if (policy.requiresWorkspace && !workspace) {
    throw new ProductAppLaunchScopeError(app);
  }

  if (!policy.requiresWorkspace && !productAppSupportsMultipleWorks(app)) {
    return { kind: 'global' };
  }

  return workspace
    ? { kind: 'workspace', workspaceId: workspace.id }
    : { kind: 'global' };
}
