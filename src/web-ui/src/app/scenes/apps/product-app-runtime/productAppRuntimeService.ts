import { productAppRuntimeAPI } from '@/infrastructure/api/service-api/ProductAppRuntimeAPI';
import type {
  ProductAppCatalogEntry,
} from '@/infrastructure/api/service-api/AppCatalogAPI';
import { appCatalogAPI } from '@/infrastructure/api/service-api/AppCatalogAPI';
import { requestWorkRefresh } from '@/app/agentic-os/work/data/workStore';
import { useWorkStore } from '@/app/agentic-os/work/data/workStore';
import { productAppWorkRef } from '@/app/agentic-os/work/domain/productAppRefs';
import { getProductAppLaunchBehavior } from '@/app/agentic-os/work/domain/productAppLaunchPolicy';
import type {
  RuntimeInstanceRef,
  WorkAppRef,
  WorkRecord,
  WorkScope,
  WorkSurfaceRef,
} from '@/app/agentic-os/work/domain/workTypes';
import type {
  OpenProductAppRuntimeOptions,
  ProductAppRuntimeHostTarget,
} from './productAppRuntimeOpenTypes';
import { openProductAppRuntimeHost } from './productAppRuntimeHostService';
import {
  appScopeFromWorkspacePath,
  normalizeAppScope,
  systemAppScope,
  type AppScope,
  workspacePathFromAppScope,
} from '@/shared/types/app-scope';
import type { WorkspaceSurfaceContext } from '@/app/navigation/workspaceSurfaceTypes';
import { ProductAppStudioPreviewResolveError } from './productAppRuntimePreviewError';
import {
  productAppRuntimeHostAPI,
  type ProductAppHostSurface,
} from '@/infrastructure/api/service-api/ProductAppRuntimeHostAPI';
export {
  ProductAppStudioPreviewResolveError,
  isProductAppStudioPreviewResolveError,
  type ProductAppStudioPreviewFailureContext,
} from './productAppRuntimePreviewError';

export interface OpenProductAppRuntimeForWorkSurfaceRequest {
  workId: string;
  productAppId: string;
  runtimeInstanceId?: string | null;
  productAppVersion?: string | null;
  componentLockDigest?: string | null;
  productAppSurfaceId?: string | null;
  surfaceId?: string | null;
}

export interface ResolveProductAppStudioPreviewOptions {
  scope?: AppScope | null;
  theme?: string | null;
}

export interface ProductAppStudioPreviewTarget {
  kind: 'product-app-preview';
  productApp: ProductAppCatalogEntry;
  work: WorkRecord;
  workContext: WorkspaceSurfaceContext;
  appRef: WorkAppRef | null;
  surface: Extract<WorkSurfaceRef, { kind: 'application_surface' }>;
  runtimeInstance: RuntimeInstanceRef | null;
  resolvedRuntime: Awaited<ReturnType<typeof productAppRuntimeAPI.resolveProductAppRuntimeInstance>>;
  hostSurface: ProductAppHostSurface;
  scope: AppScope;
  workspacePath?: string;
}

function workScopeFromAppScope(scope: AppScope): WorkScope {
  const workspacePath = workspacePathFromAppScope(scope);
  return workspacePath ? { kind: 'workspace', workspacePath } : { kind: 'system' };
}

function workContext(work: WorkRecord): WorkspaceSurfaceContext {
  return { kind: 'work', workId: work.id };
}

function runtimeScopeFromOptions(options: OpenProductAppRuntimeOptions): AppScope {
  return normalizeAppScope(
    options.scope ||
    appScopeFromWorkspacePath(options.workspacePath) ||
    systemAppScope(),
  );
}

function applicationSurfaceForWork(work: WorkRecord): Extract<WorkSurfaceRef, { kind: 'application_surface' }> {
  const surface = work.primarySurface.kind === 'application_surface'
    ? work.primarySurface
    : work.surfaces.find(candidate => candidate.kind === 'application_surface');
  if (!surface || surface.kind !== 'application_surface') {
    throw new Error(`Work ${work.id} does not bind a Product App application surface.`);
  }
  return surface;
}

function productAppRefForSurface(work: WorkRecord, productAppId: string): WorkAppRef | null {
  if (work.subject.kind === 'app' && work.subject.app.appId === productAppId) {
    return work.subject.app;
  }
  return work.appRefs.find(relation => relation.app.appId === productAppId)?.app ?? null;
}

function runtimeInstanceForSurface(
  work: WorkRecord,
  surface: Extract<WorkSurfaceRef, { kind: 'application_surface' }>,
): RuntimeInstanceRef | null {
  const appRef = productAppRefForSurface(work, surface.productAppId);
  return work.runtimeInstances.find(instance =>
    instance.productAppId === surface.productAppId &&
    instance.productAppSurfaceId === surface.productAppSurfaceId &&
    instance.surfaceId === surface.surfaceId &&
    (!appRef || (
      instance.appVersion === appRef.appVersion &&
      instance.componentLockDigest === appRef.componentLockDigest
    ))
  ) ?? null;
}

async function resolveProductAppStudioPreviewWork(
  app: ProductAppCatalogEntry,
  scope: AppScope,
): Promise<WorkRecord> {
  const appRef = productAppWorkRef(app);
  const workStore = useWorkStore.getState();
  const response = await workStore.resolveAppWork({
    app: appRef,
    intent: 'develop',
    title: `${app.name} Studio Preview`,
    objective: app.goal || app.description || app.name,
    appRefs: [
      { app: appRef, role: 'subject' },
      { app: appRef, role: 'executor' },
    ],
    scope: workScopeFromAppScope(scope),
    visibility: 'secondary',
    primarySurfacePolicy: 'application_surface',
    assignment: {
      kind: 'application',
      applicationId: app.id,
    },
  });
  return response.work;
}

async function resolveProductAppRuntimeWork(
  app: ProductAppCatalogEntry,
  scope: AppScope,
): Promise<WorkRecord> {
  const appRef = productAppWorkRef(app);
  const title = app.name;
  const objective = app.goal || app.description || app.name;
  const assignment = {
    kind: 'application' as const,
    applicationId: app.id,
  };
  const appRefs = [
    { app: appRef, role: 'executor' as const },
  ];
  const workStore = useWorkStore.getState();

  if (getProductAppLaunchBehavior(app).workResolutionMode === 'resolveSingletonWork') {
    return (await workStore.resolveAppWork({
      app: appRef,
      intent: 'run',
      title,
      objective,
      appRefs,
      scope: workScopeFromAppScope(scope),
      visibility: 'primary',
      primarySurfacePolicy: 'application_surface',
      assignment,
    })).work;
  }

  return workStore.createWork({
    kind: 'app_workflow',
    title,
    objective,
    subject: {
      kind: 'app',
      app: appRef,
      intent: 'run',
    },
    appRefs,
    scope: workScopeFromAppScope(scope),
    visibility: 'primary',
    primarySurfacePolicy: 'application_surface',
    titleState: {
      source: 'application_surface',
      locked: false,
      subjectRef: app.id,
    },
    assignment,
  });
}

async function resolveProductAppRuntimeHostTarget(
  productApp: ProductAppCatalogEntry,
  work: WorkRecord,
  scope: AppScope,
  theme?: string | null,
): Promise<ProductAppRuntimeHostTarget> {
  const workspacePath = workspacePathFromAppScope(scope);
  const surface = applicationSurfaceForWork(work);
  const appRef = productAppRefForSurface(work, surface.productAppId);
  const runtimeInstance = runtimeInstanceForSurface(work, surface);
  const resolvedRuntime = await productAppRuntimeAPI.resolveProductAppRuntimeInstance({
    workId: work.id,
    productAppId: surface.productAppId,
    runtimeInstanceId: runtimeInstance?.id,
    productAppVersion: appRef?.appVersion,
    componentLockDigest: appRef?.componentLockDigest,
    productAppSurfaceId: surface.productAppSurfaceId,
    surfaceId: surface.surfaceId,
  });
  requestWorkRefresh('product-app-runtime-resolved');
  const hostSurface = await productAppRuntimeHostAPI.getHostSurface(
    resolvedRuntime.host.surfaceId,
    theme || undefined,
    workspacePath,
  );
  return {
    productApp,
    hostSurface,
    runtimeContext: resolvedRuntime.runtimeContext,
    scope,
    context: workContext(work),
  };
}

export async function resolveProductAppStudioPreviewTarget(
  appOrId: ProductAppCatalogEntry | string,
  options: ResolveProductAppStudioPreviewOptions = {},
): Promise<ProductAppStudioPreviewTarget> {
  const scope = normalizeAppScope(options.scope ?? systemAppScope());
  const workspacePath = workspacePathFromAppScope(scope);
  const productApp = typeof appOrId === 'string'
    ? await appCatalogAPI.getProductApp(appOrId)
    : appOrId;
  const work = await resolveProductAppStudioPreviewWork(productApp, scope);
  const surface = applicationSurfaceForWork(work);
  const appRef = productAppRefForSurface(work, surface.productAppId);
  const runtimeInstance = runtimeInstanceForSurface(work, surface);
  const failureContextBase = {
    kind: 'product-app-preview' as const,
    productApp,
    work,
    workContext: workContext(work),
    appRef,
    surface,
    runtimeInstance,
    scope,
    workspacePath,
  };
  let resolvedRuntime: Awaited<ReturnType<typeof productAppRuntimeAPI.resolveProductAppRuntimeInstance>>;
  try {
    resolvedRuntime = await productAppRuntimeAPI.resolveProductAppRuntimeInstance({
      workId: work.id,
      productAppId: surface.productAppId,
      runtimeInstanceId: runtimeInstance?.id,
      productAppVersion: appRef?.appVersion,
      componentLockDigest: appRef?.componentLockDigest,
      productAppSurfaceId: surface.productAppSurfaceId,
      surfaceId: surface.surfaceId,
    });
  } catch (error) {
    throw new ProductAppStudioPreviewResolveError(
      error instanceof Error ? error.message : String(error),
      {
        ...failureContextBase,
        stage: 'runtime-resolve',
      },
      error,
    );
  }
  requestWorkRefresh('product-app-studio-preview-resolved');
  let hostSurface: ProductAppHostSurface;
  try {
    hostSurface = await productAppRuntimeHostAPI.getHostSurface(
      resolvedRuntime.host.surfaceId,
      options.theme || undefined,
      workspacePath,
    );
  } catch (error) {
    throw new ProductAppStudioPreviewResolveError(
      error instanceof Error ? error.message : String(error),
      {
        ...failureContextBase,
        stage: 'host-surface-load',
        resolvedRuntime,
      },
      error,
    );
  }
  return {
    kind: 'product-app-preview',
    productApp,
    work,
    workContext: workContext(work),
    appRef,
    surface,
    runtimeInstance,
    resolvedRuntime,
    hostSurface,
    scope,
    workspacePath,
  };
}

export async function openProductAppRuntimeForWorkSurface(
  request: OpenProductAppRuntimeForWorkSurfaceRequest,
  options: OpenProductAppRuntimeOptions = {}
): Promise<void> {
  const scope = runtimeScopeFromOptions(options);
  const workspacePath = workspacePathFromAppScope(scope);
  const productApp = await appCatalogAPI.getProductApp(request.productAppId);
  const resolved = await productAppRuntimeAPI.resolveProductAppRuntimeInstance({
    workId: request.workId,
    productAppId: request.productAppId,
    runtimeInstanceId: request.runtimeInstanceId,
    productAppVersion: request.productAppVersion,
    componentLockDigest: request.componentLockDigest,
    productAppSurfaceId: request.productAppSurfaceId,
    surfaceId: request.surfaceId,
  });
  requestWorkRefresh('product-app-runtime-resolved');
  const hostSurface = await productAppRuntimeHostAPI.getHostSurface(
    resolved.host.surfaceId,
    options.theme || undefined,
    workspacePath,
  );
  await openProductAppRuntimeHost({
    productApp,
    hostSurface,
    runtimeContext: resolved.runtimeContext,
    scope,
    context: options.context ?? { kind: 'work', workId: request.workId },
  }, {
    ...options,
    scope,
    runtimeContext: resolved.runtimeContext,
  });
}

export async function openProductAppRuntime(
  appOrId: ProductAppCatalogEntry | string,
  options: OpenProductAppRuntimeOptions = {}
): Promise<void> {
  const scope = runtimeScopeFromOptions(options);
  const productApp = typeof appOrId === 'string'
    ? await appCatalogAPI.getProductApp(appOrId)
    : appOrId;
  const work = await resolveProductAppRuntimeWork(productApp, scope);
  const target = await resolveProductAppRuntimeHostTarget(
    productApp,
    work,
    scope,
    options.theme,
  );
  await openProductAppRuntimeHost(target, {
    ...options,
    scope,
  });
}
