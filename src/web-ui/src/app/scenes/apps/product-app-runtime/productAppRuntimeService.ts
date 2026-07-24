import { requestWorkRefresh, useWorkStore } from '@/app/agentic-os/work/data/workStore';
import { agenticOsWorkApi } from '@/app/agentic-os/work/data/workApi';
import { productAppWorkRef } from '@/app/agentic-os/work/domain/productAppRefs';
import type {
  WorkAppRef,
  WorkLocator,
  WorkRecord,
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
  workScopeFromAppScope,
  workspacePathFromAppScope,
} from '@/shared/types/app-scope';
import { createLogger } from '@/shared/utils/logger';
import { openProductAppRuntimeHost } from './productAppRuntimeHostService';
import type {
  OpenProductAppRuntimeOptions,
  ProductAppRuntimeHostTarget,
} from './productAppRuntimeOpenTypes';

const log = createLogger('ProductAppRuntimeService');

export interface OpenProductAppRuntimeForWorkSurfaceRequest {
  workLocator: WorkLocator;
  slotId: string;
  appId: string;
  productAppSurfaceId?: string | null;
  surfaceId?: string | null;
}

function runtimeScopeFromOptions(options: OpenProductAppRuntimeOptions): AppScope {
  return normalizeAppScope(options.scope ?? systemAppScope());
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
    'productAppSurfaceId' | 'surfaceId'
  > = {},
): Promise<ProductAppRuntimeHostTarget> {
  const surface = applicationSurfaceForWork(work, appRef.appId);
  const resolved = await productAppRuntimeAPI.resolveProductAppRuntimeInstance({
    locator: { scope: work.scope, workId: work.id },
    slotId: appRef.slotId,
    appId: appRef.appId,
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
      appId: resolved.appId,
      displayName: resolved.appName,
      releaseId: resolved.releaseId,
      workMultiplicity: resolved.workMultiplicity,
    },
    hostSurface,
    runtimeContext: resolved.runtimeContext,
    scope,
    context: options.context ?? { kind: 'work', workId: work.id },
  };
}

async function initializeCreatedProductAppWork(
  target: ProductAppRuntimeHostTarget,
  work: WorkRecord,
): Promise<void> {
  const initializers = (target.hostSurface.backends ?? [])
    .filter(backend => backend.actions.some(action => action.name === 'initializeWork'));
  for (const backend of initializers) {
    const backendAlias = backend.role?.trim() || backend.id;
    const result = await productAppRuntimeHostAPI.backendCall(
      target.hostSurface.id,
      `${backendAlias}.initializeWork`,
      { title: work.title },
      {
        runtimeContext: target.runtimeContext,
        workspacePath: workspacePathFromAppScope(target.scope),
        idempotencyKey: `initialize-work-${work.id}-${backend.id}`,
      },
    );
    const bridgeResult = result.bridgeResult as { status?: string; stderr?: string } | undefined;
    if (result.status === 'failed' || bridgeResult?.status === 'failed') {
      throw new Error(bridgeResult?.stderr || `Failed to initialize Product App Work ${work.id}`);
    }
  }
}

async function rollbackCreatedProductAppWork(
  work: WorkRecord,
  creationError: unknown,
): Promise<void> {
  const locator: WorkLocator = { scope: work.scope, workId: work.id };
  try {
    const result = await useWorkStore.getState().deleteWork(locator, {
      deleteLinkedSessions: true,
    });
    if (!result.deleted) {
      throw new Error(`Work ${work.id} was not deleted`);
    }
  } catch (rollbackError) {
    log.error('Failed to roll back incomplete Product App Work', {
      workId: work.id,
      creationError,
      rollbackError,
    });
    const creationMessage =
      creationError instanceof Error ? creationError.message : String(creationError);
    const rollbackMessage =
      rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
    throw new Error(
      `Product App creation failed: ${creationMessage}; rollback failed: ${rollbackMessage}`,
    );
  }
}

export async function openProductAppRuntimeForWorkSurface(
  request: OpenProductAppRuntimeForWorkSurfaceRequest,
  options: OpenProductAppRuntimeOptions = {},
): Promise<void> {
  if (!navigationIsCurrent(options)) return;
  const scope = runtimeScopeFromOptions(options);
  const work = await agenticOsWorkApi.getWork(request.workLocator);
  if (!navigationIsCurrent(options)) return;
  const appRef = immutableAppRefForWork(work, request.appId, request.slotId);
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
    workspacePath: scope.kind === 'workspace' ? scope.workspacePath : undefined,
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
  const createExplicitMultipleWork = app.runtime.workMultiplicity === 'multiple'
    && options.workMode === 'create';
  let created = createExplicitMultipleWork;
  const work = createExplicitMultipleWork
    ? await useWorkStore.getState().createWork({
        kind: 'app_workflow',
        title,
        objective,
        subject: { kind: 'app', app: appRef, intent: 'use' },
        appRefs: [{ app: appRef, role: 'executor' }],
        scope: request.scope,
        workspacePath: request.workspacePath,
        visibility: request.visibility,
        primarySurfacePolicy: request.primarySurfacePolicy,
        primarySurface: request.primarySurface,
        assignment: request.assignment,
      })
    : await useWorkStore.getState().resolveAppWork(request).then((resolved) => {
        created = resolved.created;
        return resolved.work;
      });
  try {
    const target = await resolveRuntimeTarget(work, appRef, scope, options);
    if (created) {
      await initializeCreatedProductAppWork(target, work);
    }
    const context: WorkspaceSurfaceContext = options.context ?? { kind: 'work', workId: work.id };
    await openProductAppRuntimeHost(target, {
      ...options,
      scope,
      context,
      runtimeContext: target.runtimeContext,
    });
  } catch (error) {
    if (created) {
      await rollbackCreatedProductAppWork(work, error);
    }
    throw error;
  }
}
