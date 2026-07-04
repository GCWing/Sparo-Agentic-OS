import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';
import { i18nService } from '@/infrastructure/i18n';
import { notificationService } from '@/shared/notification-system';

export type AppInteractionModel = 'conversation' | 'interactiveWorkspace';
export type AppWorkMultiplicity = 'multiple' | 'singleton';
export type AppTruthSource = 'ownedObjectState' | 'runtimeFact';
export type AppSurfaceMode = 'chatPrimary' | 'sidecarLinked' | 'immersivePrimary' | 'embeddedObject';
export type AppInstallScope = 'system' | 'workspace' | 'project';
export type AppCatalogVisibility = 'discoverable' | 'installedOnly' | 'hidden';
export type WorkObjectScope = 'global' | 'workspace' | 'project' | 'asset' | 'device' | 'runtime';
export type AppDataRetentionPolicy = 'workRuntimeScoped' | 'sessionScoped' | 'userManaged' | 'externalSystem';
export type AppDataDeletionPolicy = 'deleteWithWork' | 'deleteOnUserRequest' | 'noDurableData' | 'externalSystem';
export type AppDataMigrationPolicy = 'notSupported' | 'exportImport' | 'schemaVersioned' | 'externalSystem';
export type AppDataSharePolicy = 'excludeRuntimePrivateData' | 'declaredWorkObjectsOnly' | 'externalReferenceOnly';
export type ComponentKind = 'surface' | 'agent' | 'bridge' | 'runtime' | 'tool' | 'skill';
export type ComponentSource = 'private' | 'shared';
export type ComponentPackageSource = 'appPrivate' | 'shared';
export type ComponentVisibility = 'appDependency' | 'developer' | 'hidden';
export type ProductAppLaunchKind = 'agentSession' | 'applicationSurface' | 'appStudio';
export type ProductAppLaunchScopeRequirement = 'systemAllowed' | 'workspaceOptional' | 'workspaceRequired';
export type ProductAppRehearsalScenarioKind = 'user-path' | 'agent-chat' | 'capability' | 'release-gate';
export type ProductAppRehearsalAction = 'open' | 'focus' | 'click' | 'type' | 'submit' | 'observe';

export type AppIconSpec =
  | {
    kind: 'packageAsset';
    path: string;
    mimeType?: string | null;
    digest?: string | null;
    uri?: string | null;
    background?: string | null;
  }
  | {
    kind: 'nativeAsset';
    assetId: string;
    mimeType?: string | null;
    digest?: string | null;
    uri?: string | null;
    background?: string | null;
  }
  | {
    kind: 'lucide';
    name: string;
    background?: string | null;
  }
  | {
    kind: 'monogram';
    label: string;
    seed?: string | null;
    background?: string | null;
  };

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

export interface AppDataLifecyclePolicy {
  retention?: AppDataRetentionPolicy;
  deletion?: AppDataDeletionPolicy;
  migration?: AppDataMigrationPolicy;
  share?: AppDataSharePolicy;
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

export interface ProductAppRehearsalStep {
  id: string;
  action: ProductAppRehearsalAction;
  target?: string | null;
  value?: string | null;
  expect?: string[];
}

export interface ProductAppRehearsalScenario {
  id: string;
  title: string;
  description?: string;
  kind?: ProductAppRehearsalScenarioKind;
  steps?: ProductAppRehearsalStep[];
  expected?: string[];
}

export interface ProductAppRehearsalPlan {
  version?: number;
  scenarios?: ProductAppRehearsalScenario[];
}

export type ProductAppEvalExpectationKind =
  | 'json-equals'
  | 'json-contains'
  | 'text-contains'
  | 'result-count-at-least';

export interface ProductAppEvalExpectation {
  kind?: ProductAppEvalExpectationKind;
  path?: string | null;
  value?: unknown;
}

export interface ProductAppEvalCase {
  id: string;
  title: string;
  description?: string;
  componentId?: string | null;
  implementationRef?: string | null;
  action?: string | null;
  toolName?: string | null;
  input?: unknown;
  expectations?: ProductAppEvalExpectation[];
  tags?: string[];
  required?: boolean;
}

export interface ProductAppEvalPlan {
  version?: number;
  cases?: ProductAppEvalCase[];
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
  dataLifecycle?: AppDataLifecyclePolicy | null;
  truthSource?: AppTruthSource | null;
  primarySurface?: SurfaceRef | null;
  primarySurfaceMode?: AppSurfaceMode | null;
  components?: AppComponentRef[];
  componentLockId: string;
  permissions: AppPermissionSummary;
  installScope: AppInstallScope;
  catalogVisibility: AppCatalogVisibility;
  enabled: boolean;
  icon: AppIconSpec;
  category?: string;
  tags?: string[];
  launch?: ProductAppLaunch | null;
}

export interface ProductAppCatalogEntry extends AppDefinition {
  componentLockDigest: string;
  packageDigest?: string | null;
  updateAvailable?: boolean;
  installedComponentLockDigest?: string | null;
  availableComponentLockDigest?: string | null;
  installedPackageDigest?: string | null;
  availablePackageDigest?: string | null;
  catalogReleaseId?: string | null;
  catalogReleaseLabel?: string | null;
  catalogReleaseNotes?: string | null;
  catalogPublishedAtMs?: number | null;
  dependencySummary?: string;
  installed?: boolean;
  discoverable?: boolean;
  librarySources?: ProductAppLibrarySource[];
  catalogSource?: ProductAppCatalogSourceRef | null;
  catalogIssues?: ProductAppCatalogIssue[];
  management?: ProductAppManagementPolicy;
  rehearsalPlan?: ProductAppRehearsalPlan | null;
  evalPlan?: ProductAppEvalPlan | null;
}

export type AppCatalogEntry = ProductAppCatalogEntry;
export type ProductAppLibrarySource = 'installed' | 'discoverable';
export type ProductAppCatalogSourceKind = 'installedPackage' | 'builtinMarketplace' | 'publishedRelease';
export type ProductAppCatalogIssueSource = 'installedPackage' | 'catalogSource';
export type AppManagementAction = 'install' | 'update' | 'disable' | 'uninstall';
export type ProductAppManagementOrigin = 'installedPackage' | 'discoverableSource' | 'updateSource' | 'hidden';
export type NativeAppManagementAction = 'configure' | 'resetState' | 'hideFromHome';
export type NativeAppManagementOrigin = 'nativeSystem';
export type NativeAppOrigin = 'nativeSystem';
export type NativeAppAvailability = 'alwaysAvailable';

export interface ProductAppCatalogSourceRef {
  kind: ProductAppCatalogSourceKind;
  label: string;
  packageUri?: string | null;
}

export interface ProductAppCatalogIssue {
  source: ProductAppCatalogIssueSource;
  appId?: string | null;
  appVersion?: string | null;
  packageDir: string;
  message: string;
}

export interface ProductAppManagementPolicy {
  origin?: ProductAppManagementOrigin;
  actions?: AppManagementAction[];
  uninstall?: ProductAppUninstallPolicy | null;
}

export interface ProductAppUninstallPolicy {
  removesInstalledPackage?: boolean;
  retainsWork?: boolean;
  retainsRuntimeStorage?: boolean;
}

export interface NativeAppManagementPolicy {
  origin?: NativeAppManagementOrigin;
  actions?: NativeAppManagementAction[];
}

export interface ProductAppLibrary {
  installed: ProductAppCatalogEntry[];
  discoverable: ProductAppCatalogEntry[];
  issues?: ProductAppCatalogIssue[];
}

export interface ProductAppHomeCatalog {
  apps: ProductAppCatalogEntry[];
  issues?: ProductAppCatalogIssue[];
}

export interface NativeAppCatalogEntry {
  id: string;
  name: string;
  description: string;
  goal: string;
  interactionModel: AppInteractionModel;
  workMultiplicity?: AppWorkMultiplicity;
  workObjectKinds?: WorkObjectKind[];
  truthSource?: AppTruthSource | null;
  primarySurfaceMode: AppSurfaceMode;
  permissions: AppPermissionSummary;
  icon: AppIconSpec;
  category: string;
  tags?: string[];
  launch: ProductAppLaunch;
  origin: NativeAppOrigin;
  availability: NativeAppAvailability;
  management?: NativeAppManagementPolicy;
}

export interface AppCenterCatalog {
  native: NativeAppCatalogEntry[];
  productApps: ProductAppLibrary;
}

export interface ComponentHealthResponse {
  componentId: string;
  status: string;
  detail: string;
  checks?: ComponentHealthCheck[];
  runtime: ComponentRuntimeHealth;
}

export interface ComponentHealthCheck {
  name: string;
  status: string;
  detail: string;
}

export interface ComponentRuntimeHealth {
  recentRunCount: number;
  recentFailureCount: number;
  runtimeIssueCount: number;
  runtimeWarningCount: number;
  actions?: ComponentDiagnosticAction[];
  recentFailures?: ComponentRuntimeFailure[];
  recentLogs?: ComponentRuntimeLogEntry[];
  healthAction?: string | null;
  healthActionStatus?: string | null;
  healthActionDetail?: string | null;
  lastActivityAt?: number | null;
}

export interface ComponentDiagnosticAction {
  id: string;
  label: string;
  kind: string;
  status: string;
  detail: string;
  target?: string | null;
}

export interface ComponentRuntimeFailure {
  workId: string;
  productAppId?: string | null;
  runtimeInstanceId?: string | null;
  runId?: string | null;
  severity: string;
  message: string;
  timestampMs: number;
}

export interface ComponentRuntimeLogEntry {
  workId: string;
  productAppId?: string | null;
  runtimeInstanceId?: string | null;
  level: string;
  category: string;
  message: string;
  timestampMs: number;
}

export interface ComponentUsageResponse {
  componentId: string;
  usedByApps: string[];
  runtimeUsages?: ComponentRuntimeUsage[];
}

export interface ComponentRuntimeUsage {
  workId: string;
  productAppId?: string | null;
  runtimeInstanceId?: string | null;
  runCount: number;
  issueCount: number;
  lastActivityAt?: number | null;
}

export function productAppCatalogLabel(app: ProductAppCatalogEntry): string {
  return app.name || app.id;
}

const APP_CATALOG_CACHE_TTL_MS = 30_000;

export interface CatalogCacheOptions {
  force?: boolean;
}

interface CatalogCacheEntry<T> {
  value: T;
  timestampMs: number;
}

let appCenterCatalogCache: CatalogCacheEntry<AppCenterCatalog> | null = null;
let nativeAppCatalogCache: CatalogCacheEntry<NativeAppCatalogEntry[]> | null = null;
let productAppHomeCatalogCache: CatalogCacheEntry<ProductAppHomeCatalog> | null = null;
let productAppLibraryCache: CatalogCacheEntry<ProductAppLibrary> | null = null;
let componentCatalogCache: CatalogCacheEntry<ComponentDefinition[]> | null = null;

let appCenterCatalogRequest: Promise<AppCenterCatalog> | null = null;
let nativeAppCatalogRequest: Promise<NativeAppCatalogEntry[]> | null = null;
let productAppHomeCatalogRequest: Promise<ProductAppHomeCatalog> | null = null;
let productAppLibraryRequest: Promise<ProductAppLibrary> | null = null;
let componentCatalogRequest: Promise<ComponentDefinition[]> | null = null;
let productAppCatalogIssueSignature: string | null = null;
let productAppCatalogIssueNotifiedAtMs = 0;

const PRODUCT_APP_CATALOG_ISSUE_NOTIFY_DEDUP_MS = 30_000;

function isFreshCacheEntry<T>(
  entry: CatalogCacheEntry<T> | null,
  nowMs: number = Date.now(),
): entry is CatalogCacheEntry<T> {
  return entry !== null && nowMs - entry.timestampMs < APP_CATALOG_CACHE_TTL_MS;
}

function invalidateAppCatalogCache() {
  appCenterCatalogCache = null;
  productAppHomeCatalogCache = null;
  productAppLibraryCache = null;
  componentCatalogCache = null;
}

function productAppCatalogIssueTarget(issue: ProductAppCatalogIssue): string {
  if (issue.appId && issue.appVersion) {
    return `${issue.appId}@${issue.appVersion}`;
  }
  return issue.packageDir;
}

function productAppCatalogIssueKey(issue: ProductAppCatalogIssue): string {
  return [
    issue.source,
    issue.appId ?? '',
    issue.appVersion ?? '',
    issue.packageDir,
    issue.message,
  ].join('\u001f');
}

function notifyProductAppCatalogIssues(issues: ProductAppCatalogIssue[] | undefined): void {
  if (!issues?.length) return;

  const signature = issues.map(productAppCatalogIssueKey).sort().join('\u001e');
  const nowMs = Date.now();
  if (
    signature === productAppCatalogIssueSignature &&
    nowMs - productAppCatalogIssueNotifiedAtMs < PRODUCT_APP_CATALOG_ISSUE_NOTIFY_DEDUP_MS
  ) {
    return;
  }

  productAppCatalogIssueSignature = signature;
  productAppCatalogIssueNotifiedAtMs = nowMs;

  const first = issues[0];
  const target = productAppCatalogIssueTarget(first);
  const message = issues.length === 1
    ? i18nService.t('scenes/apps:productSystem.messages.catalogPartialFailureOne', {
        target,
        error: first.message,
      })
    : i18nService.t('scenes/apps:productSystem.messages.catalogPartialFailureMany', {
        count: issues.length,
        target,
        error: first.message,
      });

  notificationService.error(message, {
    title: i18nService.t('scenes/apps:productSystem.messages.catalogPartialFailureTitle'),
    duration: 8000,
    metadata: {
      source: 'product-app-catalog',
      issues,
    },
  });
}

export class AppCatalogAPI {
  async listNativeAppCatalog(options: CatalogCacheOptions = {}): Promise<NativeAppCatalogEntry[]> {
    if (!options.force && isFreshCacheEntry(nativeAppCatalogCache)) {
      return nativeAppCatalogCache.value;
    }
    if (!options.force && nativeAppCatalogRequest) {
      return nativeAppCatalogRequest;
    }

    const request = api.invoke<NativeAppCatalogEntry[]>('list_native_app_catalog', {})
      .then((apps) => {
        nativeAppCatalogCache = { value: apps, timestampMs: Date.now() };
        return apps;
      });
    nativeAppCatalogRequest = request;
    try {
      return await request;
    } catch (error) {
      throw createTauriCommandError('list_native_app_catalog', error);
    } finally {
      if (nativeAppCatalogRequest === request) {
        nativeAppCatalogRequest = null;
      }
    }
  }

  async listProductAppHomeCatalog(options: CatalogCacheOptions = {}): Promise<ProductAppHomeCatalog> {
    if (!options.force && isFreshCacheEntry(productAppHomeCatalogCache)) {
      return productAppHomeCatalogCache.value;
    }
    if (!options.force && productAppHomeCatalogRequest) {
      return productAppHomeCatalogRequest;
    }

    const request = api.invoke<ProductAppHomeCatalog>('list_product_app_home_catalog', {})
      .then((catalog) => {
        notifyProductAppCatalogIssues(catalog.issues);
        productAppHomeCatalogCache = { value: catalog, timestampMs: Date.now() };
        return catalog;
      });
    productAppHomeCatalogRequest = request;
    try {
      return await request;
    } catch (error) {
      throw createTauriCommandError('list_product_app_home_catalog', error);
    } finally {
      if (productAppHomeCatalogRequest === request) {
        productAppHomeCatalogRequest = null;
      }
    }
  }

  async listAppCatalog(options: CatalogCacheOptions = {}): Promise<AppCenterCatalog> {
    if (!options.force && isFreshCacheEntry(appCenterCatalogCache)) {
      return appCenterCatalogCache.value;
    }
    if (!options.force && appCenterCatalogRequest) {
      return appCenterCatalogRequest;
    }

    const request = api.invoke<AppCenterCatalog>('list_app_catalog', {})
      .then((catalog) => {
        notifyProductAppCatalogIssues(catalog.productApps.issues);
        const timestampMs = Date.now();
        appCenterCatalogCache = { value: catalog, timestampMs };
        productAppLibraryCache = { value: catalog.productApps, timestampMs };
        return catalog;
      });
    appCenterCatalogRequest = request;
    try {
      return await request;
    } catch (error) {
      throw createTauriCommandError('list_app_catalog', error);
    } finally {
      if (appCenterCatalogRequest === request) {
        appCenterCatalogRequest = null;
      }
    }
  }

  async listProductAppLibrary(options: CatalogCacheOptions = {}): Promise<ProductAppLibrary> {
    if (!options.force && isFreshCacheEntry(productAppLibraryCache)) {
      return productAppLibraryCache.value;
    }
    if (!options.force && productAppLibraryRequest) {
      return productAppLibraryRequest;
    }

    const request = api.invoke<ProductAppLibrary>('list_product_app_library', {})
      .then((library) => {
        notifyProductAppCatalogIssues(library.issues);
        productAppLibraryCache = { value: library, timestampMs: Date.now() };
        return library;
      });
    productAppLibraryRequest = request;
    try {
      return await request;
    } catch (error) {
      throw createTauriCommandError('list_product_app_library', error);
    } finally {
      if (productAppLibraryRequest === request) {
        productAppLibraryRequest = null;
      }
    }
  }

  async getProductApp(appId: string): Promise<ProductAppCatalogEntry> {
    const library = await this.listProductAppLibrary();
    const app = library.installed.find((entry) => entry.id === appId);
    if (!app) {
      throw new Error(`Installed Product App not found: ${appId}`);
    }
    return app;
  }

  async setProductAppEnabled(app: ProductAppCatalogEntry, enabled: boolean): Promise<void> {
    try {
      await api.invoke('set_product_app_enabled', {
        request: { appId: app.id, appVersion: app.version, enabled },
      });
      invalidateAppCatalogCache();
    } catch (error) {
      throw createTauriCommandError('set_product_app_enabled', error, {
        appId: app.id,
        appVersion: app.version,
        enabled,
      });
    }
  }

  async installProductApp(app: ProductAppCatalogEntry): Promise<void> {
    try {
      await api.invoke('install_product_app', {
        request: { appId: app.id, appVersion: app.version },
      });
      invalidateAppCatalogCache();
    } catch (error) {
      throw createTauriCommandError('install_product_app', error, {
        appId: app.id,
        appVersion: app.version,
      });
    }
  }

  async uninstallProductApp(app: ProductAppCatalogEntry): Promise<void> {
    try {
      await api.invoke('uninstall_product_app', {
        request: { appId: app.id, appVersion: app.version },
      });
      invalidateAppCatalogCache();
    } catch (error) {
      throw createTauriCommandError('uninstall_product_app', error, {
        appId: app.id,
        appVersion: app.version,
      });
    }
  }

  async listComponents(options: CatalogCacheOptions = {}): Promise<ComponentDefinition[]> {
    if (!options.force && isFreshCacheEntry(componentCatalogCache)) {
      return componentCatalogCache.value;
    }
    if (!options.force && componentCatalogRequest) {
      return componentCatalogRequest;
    }

    const request = api.invoke<ComponentDefinition[]>('list_components', {})
      .then((components) => {
        componentCatalogCache = { value: components, timestampMs: Date.now() };
        return components;
      });
    componentCatalogRequest = request;
    try {
      return await request;
    } catch (error) {
      throw createTauriCommandError('list_components', error);
    } finally {
      if (componentCatalogRequest === request) {
        componentCatalogRequest = null;
      }
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

  async componentHealth(
    componentId: string,
    kind?: ComponentKind,
    workspacePath?: string | null,
  ): Promise<ComponentHealthResponse> {
    try {
      return await api.invoke('component_health', {
        request: { componentId, kind, workspacePath },
      });
    } catch (error) {
      throw createTauriCommandError('component_health', error, { componentId, kind, workspacePath });
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
