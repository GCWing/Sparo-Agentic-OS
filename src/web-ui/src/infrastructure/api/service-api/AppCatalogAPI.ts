import { i18nService } from '@/infrastructure/i18n';
import {
  intelligentAppAPI,
  type ActiveAppRef,
  type AppReleaseRecord,
  type AppSlotRecord,
  type AppVariantRecord,
  type IntelligentAppOwnerKind,
} from './IntelligentAppAPI';
import { bridgeComponentAPI } from './BridgeComponentAPI';

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
export type ProductAppLaunchKind = 'agentSession' | 'applicationSurface' | 'appBuilder';
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
  usesCapabilities?: string[];
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
  usesCapabilities?: string[];
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

export interface AppLocalizedMetadata {
  name?: string | null;
  description?: string | null;
  tags?: string[];
}

export interface AppI18n {
  locales?: Record<string, AppLocalizedMetadata>;
}

export interface AppAuthor {
  name: string;
  url?: string | null;
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
  authors?: AppAuthor[];
  i18n?: AppI18n;
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
  osCapabilities?: string[];
  installScope: AppInstallScope;
  catalogVisibility: AppCatalogVisibility;
  enabled: boolean;
  icon: AppIconSpec;
  category?: string;
  tags?: string[];
  launch?: ProductAppLaunch | null;
}

export interface ProductAppCatalogEntry extends AppDefinition {
  /** Lifecycle projection fields. App Center may render these, but runtime must use them exactly. */
  slotId: string;
  appId: string;
  releaseId: string;
  availableReleaseId: string;
  configRevision: string;
  dataSchemaVersion: string;
  ownerKind: IntelligentAppOwnerKind;
  derivedFromReleaseId?: string | null;
  activeRef?: ActiveAppRef | null;
  releases?: AppReleaseRecord[];
  previousReleaseId?: string | null;
  upstreamUpdateAvailable?: boolean;
  upstreamLatestReleaseId?: string | null;
  componentLockDigest: string;
  packageDigest?: string | null;
  updateAvailable?: boolean;
  availableVersion?: string | null;
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
  authors?: AppAuthor[];
  i18n?: AppI18n;
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

export function requireActiveAppRef(app: ProductAppCatalogEntry): ActiveAppRef {
  if (!app.activeRef) {
    throw new Error(`App ${app.appId} has no active Release in this scope`);
  }
  return app.activeRef;
}

export interface ResolvedCatalogAppMeta {
  name: string;
  description: string;
  tags: string[];
}

type CatalogAppMetadataSource = {
  name: string;
  description: string;
  tags?: string[];
  i18n?: AppI18n | null;
};

function localeCandidates(locale?: string): string[] {
  const currentLocale = locale || (
    typeof i18nService.getCurrentLocale === 'function'
      ? i18nService.getCurrentLocale()
      : 'en-US'
  );
  const normalized = currentLocale.replace('_', '-');
  const language = normalized.split('-')[0];
  const languageFallback = language === 'zh'
    ? 'zh-CN'
    : language === 'en'
      ? 'en-US'
      : undefined;
  return Array.from(new Set([
    currentLocale,
    normalized,
    languageFallback,
    language,
    'en-US',
    'zh-CN',
  ].filter((value): value is string => Boolean(value))));
}

function trimmed(value: string | null | undefined): string | undefined {
  const next = value?.trim();
  return next || undefined;
}

export function resolveCatalogAppMeta(
  app: CatalogAppMetadataSource,
  locale?: string,
): ResolvedCatalogAppMeta {
  const locales = app.i18n?.locales ?? {};
  const localized = localeCandidates(locale)
    .map((candidate) => locales[candidate])
    .find(Boolean);

  return {
    name: trimmed(localized?.name) || app.name,
    description: trimmed(localized?.description) || app.description,
    tags: localized?.tags?.length ? localized.tags : app.tags ?? [],
  };
}

export function localizeCatalogApp<T extends CatalogAppMetadataSource>(
  app: T,
  locale?: string,
): T {
  const meta = resolveCatalogAppMeta(app, locale);
  return {
    ...app,
    name: meta.name,
    description: meta.description,
    tags: meta.tags,
  };
}

export function localizeCatalogApps<T extends CatalogAppMetadataSource>(
  apps: T[],
  locale?: string,
): T[] {
  return apps.map((app) => localizeCatalogApp(app, locale));
}

export interface CatalogCacheOptions {
  force?: boolean;
}

function invalidateAppCatalogCache() {
  // Lifecycle catalog is authoritative and loaded on demand; there is no
  // second mutable installation cache to invalidate.
}

function projectLifecycleEntry(
  slot: AppSlotRecord,
  variant: AppVariantRecord,
  release: AppReleaseRecord,
): ProductAppCatalogEntry {
  const activation = slot.activation;
  const isSelected = activation?.enabled === true
    && activation.selectedAppId === variant.app.appId;
  const activeRef = isSelected ? intelligentAppAPI.activeRef(slot) : null;
  const installedRelease = isSelected
    ? variant.releases.find(({ releaseId }) => releaseId === activation?.activeReleaseId) ?? release
    : null;
  const launch = release.runtime.launch;
  const primarySurface = release.runtime.primarySurface;
  const components: AppComponentRef[] = [];
  if (primarySurface) {
    components.push({
      componentId: primarySurface.componentId,
      kind: 'surface',
      source: 'private',
      role: 'primarySurface',
    });
  }
  if (launch?.targetId && !components.some(({ componentId }) => componentId === launch.targetId)) {
    components.push({
      componentId: launch.targetId,
      kind: launch.kind === 'agentSession' || launch.kind === 'appBuilder' ? 'agent' : 'runtime',
      source: 'private',
      role: 'launchTarget',
    });
  }
  const ownerKind = variant.app.owner.kind;
  const isInteractive = launch?.kind === 'applicationSurface' || Boolean(primarySurface);
  const updateAvailable = isSelected && activation.activeReleaseId !== release.releaseId;
  const managementActions: AppManagementAction[] = isSelected
    ? [updateAvailable ? 'update' : 'disable', 'uninstall']
    : ['install'];

  return {
    id: variant.app.appId,
    appId: variant.app.appId,
    slotId: slot.slotId,
    releaseId: activeRef?.releaseId ?? release.releaseId,
    availableReleaseId: release.releaseId,
    configRevision: activeRef?.configRevision ?? release.configRevision,
    dataSchemaVersion: activeRef?.dataSchemaVersion ?? release.dataSchemaVersion,
    ownerKind,
    derivedFromReleaseId: variant.app.derivedFrom?.releaseId ?? null,
    activeRef,
    releases: variant.releases,
    previousReleaseId: isSelected ? activation?.previousReleaseId ?? null : null,
    upstreamUpdateAvailable: variant.upstreamUpdateAvailable,
    upstreamLatestReleaseId: variant.upstreamLatestReleaseId ?? null,
    version: installedRelease?.version ?? release.version,
    availableVersion: release.version,
    name: variant.app.displayName,
    description: variant.app.description ?? '',
    interactionModel: isInteractive ? 'interactiveWorkspace' : 'conversation',
    workMultiplicity: release.runtime.workMultiplicity,
    primarySurface: primarySurface
      ? { componentId: primarySurface.componentId, surfaceId: primarySurface.surfaceId }
      : null,
    primarySurfaceMode: release.runtime.primarySurfaceMode ?? null,
    components,
    componentLockId: installedRelease?.componentLockDigest ?? release.componentLockDigest,
    componentLockDigest: installedRelease?.componentLockDigest ?? release.componentLockDigest,
    permissions: { fs: false, net: false, shell: false, gui: false, secrets: false, ai: false },
    osCapabilities: [],
    installScope: 'system',
    catalogVisibility: 'discoverable',
    enabled: isSelected,
    icon: release.runtime.icon,
    category: release.runtime.category,
    tags: release.runtime.tags,
    launch: launch ? {
      kind: launch.kind,
      targetId: launch.targetId,
      scopeRequirement: launch.scopeRequirement,
      agentType: launch.agentType,
      surfaceId: launch.surfaceId,
    } : null,
    installed: isSelected,
    discoverable: !isSelected,
    updateAvailable,
    catalogReleaseId: release.releaseId,
    catalogReleaseLabel: release.label,
    catalogReleaseNotes: release.notes,
    catalogPublishedAtMs: release.createdAtMs,
    packageDigest: installedRelease?.artifactDigest ?? release.artifactDigest,
    installedPackageDigest: installedRelease?.artifactDigest ?? null,
    availablePackageDigest: release.artifactDigest,
    installedComponentLockDigest: installedRelease?.componentLockDigest ?? null,
    availableComponentLockDigest: release.componentLockDigest,
    dependencySummary: `${components.length} components`,
    librarySources: isSelected ? ['installed'] : ['discoverable'],
    management: {
      origin: ownerKind === 'system' ? 'discoverableSource' : 'installedPackage',
      actions: ownerKind === 'system'
        ? managementActions.filter((action) => action !== 'uninstall')
        : managementActions,
      uninstall: {
        removesInstalledPackage: ownerKind !== 'system',
        retainsWork: true,
        retainsRuntimeStorage: true,
      },
    },
  };
}

export class AppCatalogAPI {
  async listNativeAppCatalog(options: CatalogCacheOptions = {}): Promise<NativeAppCatalogEntry[]> {
    void options;
    // Native/system Apps are lifecycle-managed Releases now. The native lane is
    // intentionally empty; the original App Center layout remains unchanged.
    return [];
  }

  async listProductAppHomeCatalog(options: CatalogCacheOptions = {}): Promise<ProductAppHomeCatalog> {
    const library = await this.listProductAppLibrary(options);
    return { apps: library.installed, issues: library.issues };
  }

  async listAppCatalog(options: CatalogCacheOptions = {}): Promise<AppCenterCatalog> {
    return {
      native: await this.listNativeAppCatalog(options),
      productApps: await this.listProductAppLibrary(options),
    };
  }

  async listProductAppLibrary(options: CatalogCacheOptions = {}): Promise<ProductAppLibrary> {
    void options;
    const catalog = await intelligentAppAPI.listCatalog();
    const entries = catalog.slots.flatMap((slot) => slot.variants.flatMap((variant) => {
      const release = variant.latestRelease
        ?? [...variant.releases].sort((left, right) => right.createdAtMs - left.createdAtMs)[0];
      return release ? [projectLifecycleEntry(slot, variant, release)] : [];
    }));
    return {
      installed: entries.filter((entry) => entry.installed),
      discoverable: entries.filter((entry) => !entry.installed || entry.updateAvailable),
      issues: [],
    };
  }

  async getProductApp(appId: string): Promise<ProductAppCatalogEntry> {
    const library = await this.listProductAppLibrary();
    const app = [...library.installed, ...library.discoverable]
      .find((entry) => entry.id === appId);
    if (!app) {
      throw new Error(`Installed Product App not found: ${appId}`);
    }
    return localizeCatalogApp(app);
  }

  async setProductAppEnabled(app: ProductAppCatalogEntry, enabled: boolean): Promise<void> {
    if (!enabled) {
      await intelligentAppAPI.deactivateSlot(app.slotId);
      invalidateAppCatalogCache();
      return;
    }
    await this.installProductApp(app);
  }

  async installProductApp(app: ProductAppCatalogEntry): Promise<void> {
    const review = await intelligentAppAPI.getReleaseCapabilityReview(
      app.appId,
      app.availableReleaseId,
    );
    if (review.requiresApproval && !review.approved) {
      throw new Error(`Capability approval required for App ${app.appId} Release ${app.availableReleaseId}`);
    }
    await intelligentAppAPI.activateRelease({
      slotId: app.slotId,
      appId: app.appId,
      releaseId: app.availableReleaseId,
    });
    invalidateAppCatalogCache();
  }

  async uninstallProductApp(app: ProductAppCatalogEntry): Promise<void> {
    if (app.installed) {
      await intelligentAppAPI.deactivateSlot(app.slotId);
    }
    if (app.ownerKind !== 'system') {
      await intelligentAppAPI.removeApp(app.appId);
    }
    invalidateAppCatalogCache();
  }

  async listComponents(options: CatalogCacheOptions = {}): Promise<ComponentDefinition[]> {
    void options;
    const components = await bridgeComponentAPI.listBridgeComponents();
    return components.map(({ manifest }) => ({
      id: manifest.id,
      kind: 'bridge',
      name: manifest.name,
      description: manifest.description,
      packageSource: 'shared',
      capabilities: manifest.capabilities,
      permissions: Object.entries(manifest.permissions ?? {}).flatMap(([kind, scopes]) => (
        scopes ? [{ kind, scopes: Array.isArray(scopes) ? scopes.map(String) : undefined }] : []
      )),
      visibility: 'developer',
      implementationRef: manifest.runtime.entry,
    }));
  }

  async getComponent(componentId: string, kind?: ComponentKind): Promise<ComponentDefinition> {
    void kind;
    const { manifest } = await bridgeComponentAPI.getBridgeComponent(componentId);
    return (await this.listComponents()).find(({ id }) => id === manifest.id)
      ?? Promise.reject(new Error(`Component not found: ${componentId}`));
  }

  async componentHealth(
    componentId: string,
    kind?: ComponentKind,
    workspacePath?: string | null,
  ): Promise<ComponentHealthResponse> {
    void kind;
    void workspacePath;
    const runs = await bridgeComponentAPI.listBridgeComponentRuns(componentId);
    const failures = runs.filter(({ status }) => status === 'failed');
    const latest = [...runs].sort((left, right) => right.updatedAt - left.updatedAt)[0];
    return {
      componentId,
      status: failures.length > 0 ? 'warning' : 'healthy',
      detail: failures.length > 0
        ? `${failures.length} recent run(s) failed`
        : runs.length > 0 ? 'Recent component runs completed without failure' : 'No runtime evidence yet',
      checks: [{
        name: 'package',
        status: 'passed',
        detail: 'Bridge Component manifest resolved',
      }],
      runtime: {
        recentRunCount: runs.length,
        recentFailureCount: failures.length,
        runtimeIssueCount: failures.length,
        runtimeWarningCount: 0,
        recentFailures: failures.map((run) => ({
          workId: run.consumerId,
          productAppId: run.consumerKind === 'productAppRuntime' ? run.consumerId : null,
          runId: run.runId,
          severity: 'error',
          message: run.stderr || 'Component run failed',
          timestampMs: run.updatedAt,
        })),
        lastActivityAt: latest?.updatedAt ?? null,
      },
    };
  }

  async componentUsage(componentId: string, kind?: ComponentKind): Promise<ComponentUsageResponse> {
    void kind;
    const runs = await bridgeComponentAPI.listBridgeComponentRuns(componentId);
    const byConsumer = new Map<string, typeof runs>();
    for (const run of runs) {
      const current = byConsumer.get(run.consumerId) ?? [];
      current.push(run);
      byConsumer.set(run.consumerId, current);
    }
    return {
      componentId,
      usedByApps: [...new Set(runs
        .filter(({ consumerKind }) => consumerKind === 'productAppRuntime')
        .map(({ consumerId }) => consumerId))],
      runtimeUsages: [...byConsumer.entries()].map(([consumerId, consumerRuns]) => ({
        workId: consumerId,
        productAppId: consumerRuns[0]?.consumerKind === 'productAppRuntime' ? consumerId : null,
        runCount: consumerRuns.length,
        issueCount: consumerRuns.filter(({ status }) => status === 'failed').length,
        lastActivityAt: Math.max(...consumerRuns.map(({ updatedAt }) => updatedAt)),
      })),
    };
  }
}

export const appCatalogAPI = new AppCatalogAPI();
