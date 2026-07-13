import { requestWorkRefresh, useWorkStore } from '@/app/agentic-os/work/data/workStore';
import { agenticOsWorkApi } from '@/app/agentic-os/work/data/workApi';
import { productAppWorkRef } from '@/app/agentic-os/work/domain/productAppRefs';
import type {
  WorkAppRef,
  WorkRecord,
  WorkScope,
  WorkSurfaceRef,
} from '@/app/agentic-os/work/domain/workTypes';
import type { WorkspaceSurfaceContext } from '@/app/navigation/workspaceSurfaceTypes';
import type { ActiveAppRef } from '@/infrastructure/api/service-api/IntelligentAppAPI';
import { productAppRuntimeAPI } from '@/infrastructure/api/service-api/ProductAppRuntimeAPI';
import { productAppRuntimeHostAPI } from '@/infrastructure/api/service-api/ProductAppRuntimeHostAPI';
import {
  normalizeAppScope,
  systemAppScope,
  type AppScope,
  workspacePathFromAppScope,
} from '@/shared/types/app-scope';
import { openProductAppRuntimeHost } from './productAppRuntimeHostService';
import type {
  OpenProductAppRuntimeOptions,
  ProductAppRuntimeHostTarget,
} from './productAppRuntimeOpenTypes';

export interface OpenProductAppRuntimeForWorkSurfaceRequest {
  workId: string;
  slotId: string;
  appId: string;
  releaseId: string;
  configRevision: string;
  runtimeInstanceId?: string | null;
  productAppSurfaceId?: string | null;
  surfaceId?: string | null;
}

function runtimeScopeFromOptions(options: OpenProductAppRuntimeOptions): AppScope {
  return normalizeAppScope(options.scope ?? systemAppScope());
}

function workScopeFromAppScope(scope: AppScope): WorkScope {
  return scope.kind === 'workspace'
    ? { kind: 'workspace', workspacePath: scope.workspacePath }
    : { kind: 'system' };
}

function navigationIsCurrent(options: OpenProductAppRuntimeOptions): boolean {
  return options.isNavigationCurrent?.() !== false;
}

function applicationSurfaceForWork(
  work: WorkRecord,
  appId: string,
): Extract<WorkSurfaceRef, { kind: 'application_surface' }> {
  const candidates = [work.primarySurface, ...work.surfaces];
  const surface = candidates.find((candidate): candidate is Extract<WorkSurfaceRef, { kind: 'application_surface' }> => (
    candidate.kind === 'application_surface' && candidate.productAppId === appId
  ));
  if (!surface) {
    throw new Error(`Work ${work.id} has no application surface for App ${appId}`);
  }
  return surface;
}

function immutableAppRefForWork(work: WorkRecord, appId: string, slotId: string): WorkAppRef {
  const subject = work.subject.kind === 'app' ? work.subject.app : null;
  const appRef = subject?.appId === appId && subject.slotId === slotId
    ? subject
    : work.appRefs.find(({ app }) => app.appId === appId && app.slotId === slotId)?.app;
  if (!appRef) {
    throw new Error(`Work ${work.id} does not bind slot ${slotId} to App ${appId}`);
  }
  return appRef;
}

async function resolveRuntimeTarget(
  work: WorkRecord,
  appRef: WorkAppRef,
  scope: AppScope,
  options: OpenProductAppRuntimeOptions,
  requestOverrides: Pick<
    OpenProductAppRuntimeForWorkSurfaceRequest,
    'runtimeInstanceId' | 'productAppSurfaceId' | 'surfaceId'
  > = {},
): Promise<ProductAppRuntimeHostTarget> {
  const surface = applicationSurfaceForWork(work, appRef.appId);
  const resolved = await productAppRuntimeAPI.resolveProductAppRuntimeInstance({
    workId: work.id,
    slotId: appRef.slotId,
    appId: appRef.appId,
    releaseId: appRef.releaseId,
    configRevision: appRef.configRevision,
    dataSchemaVersion: appRef.dataSchemaVersion,
    runtimeInstanceId: requestOverrides.runtimeInstanceId,
    productAppSurfaceId: requestOverrides.productAppSurfaceId ?? surface.productAppSurfaceId,
    surfaceId: requestOverrides.surfaceId ?? surface.surfaceId,
  });
  if (!navigationIsCurrent(options)) {
    throw new Error('Runtime navigation was superseded');
  }
  requestWorkRefresh('product-app-runtime-resolved');
  const hostSurface = await productAppRuntimeHostAPI.getHostSurface(
    resolved.host.surfaceId,
    options.theme || undefined,
    workspacePathFromAppScope(scope),
  );
  return {
    intelligentApp: {
      appId: appRef.appId,
      displayName: options.title?.trim() || work.title || appRef.appId,
      releaseId: appRef.releaseId,
    },
    hostSurface,
    runtimeContext: resolved.runtimeContext,
    scope,
    context: options.context ?? { kind: 'work', workId: work.id },
  };
}

export async function openProductAppRuntimeForWorkSurface(
  request: OpenProductAppRuntimeForWorkSurfaceRequest,
  options: OpenProductAppRuntimeOptions = {},
): Promise<void> {
  if (!navigationIsCurrent(options)) return;
  const scope = runtimeScopeFromOptions(options);
  const work = await agenticOsWorkApi.getWork(request.workId);
  if (!navigationIsCurrent(options)) return;
  const appRef = immutableAppRefForWork(work, request.appId, request.slotId);
  if (
    appRef.releaseId !== request.releaseId
    || appRef.configRevision !== request.configRevision
  ) {
    throw new Error(`Work ${work.id} immutable App binding does not match the requested Release`);
  }
  const target = await resolveRuntimeTarget(work, appRef, scope, options, request);
  if (!navigationIsCurrent(options)) return;
  await openProductAppRuntimeHost(target, {
    ...options,
    scope,
    runtimeContext: target.runtimeContext,
  });
}

export async function openProductAppRuntime(
  app: ActiveAppRef,
  options: OpenProductAppRuntimeOptions = {},
): Promise<void> {
  const declaredSurface = app.runtime.primarySurface;
  if (app.runtime.launch?.kind !== 'applicationSurface' || !declaredSurface) {
    throw new Error(`App ${app.appId} Release ${app.releaseId} has no application surface launch`);
  }
  const scope = runtimeScopeFromOptions(options);
  const appRef = productAppWorkRef(app);
  const title = options.title?.trim() || app.appId;
  const objective = options.objective?.trim() || title;
  const request = {
    app: appRef,
    intent: 'use' as const,
    title,
    objective,
    scope: workScopeFromAppScope(scope),
    visibility: 'primary' as const,
    primarySurfacePolicy: 'application_surface' as const,
    primarySurface: {
      kind: 'application_surface' as const,
      productAppId: app.appId,
      productAppSurfaceId: declaredSurface.componentId,
      surfaceId: declaredSurface.surfaceId ?? declaredSurface.componentId,
    },
    assignment: {
      kind: 'application' as const,
      applicationId: app.appId,
    },
  };
  const work = app.runtime.workMultiplicity === 'singleton'
    ? (await useWorkStore.getState().resolveAppWork(request)).work
    : await useWorkStore.getState().createWork({
        kind: 'app_workflow',
        title,
        objective,
        subject: { kind: 'app', app: appRef, intent: 'use' },
        appRefs: [{ app: appRef, role: 'executor' }],
        scope: request.scope,
        visibility: request.visibility,
        primarySurfacePolicy: request.primarySurfacePolicy,
        primarySurface: request.primarySurface,
        assignment: request.assignment,
      });
  const target = await resolveRuntimeTarget(work, appRef, scope, options);
  const context: WorkspaceSurfaceContext = options.context ?? { kind: 'work', workId: work.id };
  await openProductAppRuntimeHost(target, {
    ...options,
    scope,
    context,
    runtimeContext: target.runtimeContext,
  });
}
