import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';

export type AppInteractionModel = 'conversation' | 'interactiveWorkspace';
export type AppWorkMultiplicity = 'multiple' | 'singleton';
export type AppTruthSource = 'ownedObjectState' | 'runtimeFact';
export type AppSurfaceMode = 'chatPrimary' | 'sidecarLinked' | 'immersivePrimary' | 'embeddedObject';
export type AppInstallScope = 'system' | 'workspace' | 'project';
export type AppCatalogVisibility = 'discoverable' | 'installedOnly' | 'hidden';
export type WorkObjectScope = 'global' | 'workspace' | 'project' | 'asset' | 'device' | 'runtime';
export type ComponentKind = 'surface' | 'agent' | 'bridge' | 'runtime' | 'tool' | 'skill';
export type ComponentSource = 'private' | 'shared';
export type ComponentPackageSource = 'appPrivate' | 'shared';
export type ComponentVisibility = 'appDependency' | 'developer' | 'hidden';
export type ProductAppLaunchKind = 'agentSession' | 'applicationSurface' | 'appStudio' | 'componentStudio';
export type ProductAppLaunchScopeRequirement = 'systemAllowed' | 'workspaceOptional' | 'workspaceRequired';

export interface SurfaceRef {
  componentId: string;
  surfaceId?: string | null;
}

export interface WorkObjectKind {
  id: string;
  label: string;
  scope: WorkObjectScope;
  identitySchema?: Record<string, unknown>;
  contextSchema?: Record<string, unknown>;
}

export interface AppComponentRef {
  componentId: string;
  kind: ComponentKind;
  source: ComponentSource;
  role: string;
  version?: string | null;
  capabilities?: string[];
}

export interface CapabilityRef {
  id: string;
  title: string;
  description?: string;
  actions?: string[];
}

export interface PermissionSpec {
  kind: string;
  summary?: string;
  scopes?: string[];
}

export interface ComponentOwnerApp {
  appId: string;
  appVersion: string;
}

export interface ComponentDefinition {
  id: string;
  version?: string | null;
  kind: ComponentKind;
  name: string;
  description: string;
  packageSource: ComponentPackageSource;
  ownerApp?: ComponentOwnerApp | null;
  capabilities?: CapabilityRef[];
  permissions?: PermissionSpec[];
  usedByApps?: string[];
  visibility: ComponentVisibility;
  dependencies?: AppComponentRef[];
  implementationRef?: string | null;
}

export interface ComponentLockEntry {
  fqid: string;
  componentId: string;
  kind: ComponentKind;
  source: ComponentSource;
  digest: string;
  version?: string | null;
  scope?: string | null;
}

export interface ComponentLock {
  appId: string;
  version: string;
  lockVersion: number;
  resolvedComponents: ComponentLockEntry[];
  permissionDigest: string;
  componentGraphDigest: string;
}

export interface ProductAppLaunch {
  kind: ProductAppLaunchKind;
  targetId: string;
  scopeRequirement?: ProductAppLaunchScopeRequirement;
  agentType?: string | null;
  surfaceId?: string | null;
}

export interface AppPermissionSummary {
  fs?: boolean;
  net?: boolean;
  shell?: boolean;
  gui?: boolean;
  secrets?: boolean;
  ai?: boolean;
}

export interface AppDefinition {
  id: string;
  version: string;
  name: string;
  description: string;
  goal: string;
  interactionModel: AppInteractionModel;
  workMultiplicity?: AppWorkMultiplicity;
  workObjectKinds?: WorkObjectKind[];
  truthSource?: AppTruthSource | null;
  primarySurface: SurfaceRef;
  primarySurfaceMode: AppSurfaceMode;
  components?: AppComponentRef[];
  componentLockId: string;
  permissions: AppPermissionSummary;
  installScope: AppInstallScope;
  catalogVisibility: AppCatalogVisibility;
  enabled: boolean;
  icon?: string;
  category?: string;
  tags?: string[];
  launch?: ProductAppLaunch | null;
}

export interface ProductAppCatalogEntry extends AppDefinition {
  componentLockDigest: string;
  dependencySummary?: string;
}

export type AppCatalogEntry = ProductAppCatalogEntry;

export interface ComponentHealthResponse {
  componentId: string;
  status: string;
  detail: string;
}

export interface ComponentUsageResponse {
  componentId: string;
  usedByApps: string[];
}

export interface ResolveProductAppSurfaceRequest {
  appId: string;
  surfaceComponentId?: string | null;
  surfaceId?: string | null;
}

export interface ResolvedProductAppSurface {
  productAppId: string;
  productAppVersion: string;
  componentLockDigest: string;
  surfaceComponentId: string;
  surfaceId: string;
  implementationRef: string;
  runtimeSurfaceId: string;
}

export interface CreateProductAppPackageDraft {
  appId: string;
  name: string;
  description: string;
  goal: string;
  version?: string;
  agentType?: string;
  category?: string;
  tags?: string[];
  primarySurfaceMode?: AppSurfaceMode;
  truthSource?: AppTruthSource | null;
}

export interface WrittenProductAppPackage {
  appId: string;
  version: string;
  componentLockDigest: string;
  packageDir: string;
}

export interface CreateComponentPackageDraft {
  componentId: string;
  kind: ComponentKind;
  name: string;
  description: string;
  version?: string;
  implementationRef?: string | null;
}

export interface WrittenComponentPackage {
  componentId: string;
  kind: ComponentKind;
  version: string;
  packageDir: string;
}

export function productAppCatalogLabel(app: ProductAppCatalogEntry): string {
  return app.name || app.id;
}

export class AppCatalogAPI {
  async listAppCatalog(): Promise<ProductAppCatalogEntry[]> {
    try {
      return await api.invoke('list_app_catalog', {});
    } catch (error) {
      throw createTauriCommandError('list_app_catalog', error);
    }
  }

  async createProductAppPackage(
    request: CreateProductAppPackageDraft,
  ): Promise<WrittenProductAppPackage> {
    try {
      return await api.invoke('create_product_app_package', { request });
    } catch (error) {
      throw createTauriCommandError('create_product_app_package', error, { appId: request.appId });
    }
  }

  async createComponentPackage(
    request: CreateComponentPackageDraft,
  ): Promise<WrittenComponentPackage> {
    try {
      return await api.invoke('create_component_package', { request });
    } catch (error) {
      throw createTauriCommandError('create_component_package', error, {
        componentId: request.componentId,
        kind: request.kind,
      });
    }
  }

  async getProductApp(appId: string): Promise<ProductAppCatalogEntry> {
    const apps = await this.listAppCatalog();
    const app = apps.find((entry) => entry.id === appId);
    if (!app) {
      throw new Error(`Product App not found: ${appId}`);
    }
    return app;
  }

  async listComponents(): Promise<ComponentDefinition[]> {
    try {
      return await api.invoke('list_components', {});
    } catch (error) {
      throw createTauriCommandError('list_components', error);
    }
  }

  async resolveProductAppSurface(
    request: ResolveProductAppSurfaceRequest,
  ): Promise<ResolvedProductAppSurface> {
    try {
      return await api.invoke('resolve_product_app_surface', { request });
    } catch (error) {
      throw createTauriCommandError('resolve_product_app_surface', error, {
        appId: request.appId,
        surfaceComponentId: request.surfaceComponentId,
      });
    }
  }

  async getComponent(componentId: string, kind?: ComponentKind): Promise<ComponentDefinition> {
    try {
      return await api.invoke('get_component', {
        request: { componentId, kind },
      });
    } catch (error) {
      throw createTauriCommandError('get_component', error, { componentId, kind });
    }
  }

  async componentHealth(componentId: string, kind?: ComponentKind): Promise<ComponentHealthResponse> {
    try {
      return await api.invoke('component_health', {
        request: { componentId, kind },
      });
    } catch (error) {
      throw createTauriCommandError('component_health', error, { componentId, kind });
    }
  }

  async componentUsage(componentId: string, kind?: ComponentKind): Promise<ComponentUsageResponse> {
    try {
      return await api.invoke('component_usage', {
        request: { componentId, kind },
      });
    } catch (error) {
      throw createTauriCommandError('component_usage', error, { componentId, kind });
    }
  }
}

export const appCatalogAPI = new AppCatalogAPI();
