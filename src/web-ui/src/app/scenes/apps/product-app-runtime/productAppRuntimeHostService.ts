import { productAppSessionAPI } from '@/infrastructure/api/service-api/ProductAppSessionAPI';
import { openWorkspaceScene, openWorkspaceSession } from '@/app/navigation/workspaceNavigation';
import type { WorkspaceSceneId } from '@/app/navigation/workspaceSceneTypes';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import {
  getBackendAgentType,
  getProductAppRuntimeAgentType,
  getProductAppRuntimeSessionDescriptor,
  type SessionDescriptor,
} from '@/flow_chat/domain/sessionDescriptor';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import type { ProductAppRuntimeSessionMetadata } from '@/shared/types/session-history';
import {
  normalizeAppScope,
  workspacePathFromAppScope,
} from '@/shared/types/app-scope';
import {
  buildProductAppRuntimeMetadata,
  isCompositeProductAppRuntimeHost,
} from './productAppRuntimeInteraction';
import { registerProductAppRuntimeToolCardManifests } from './productAppRuntimeToolCardManifests';
import type {
  OpenProductAppRuntimeOptions,
  ProductAppRuntimeHostTarget,
} from './productAppRuntimeOpenTypes';
import type {
  ProductAppHostSurface,
  ProductAppHostSurfaceMeta,
} from '@/infrastructure/api/service-api/ProductAppRuntimeHostAPI';

const log = createLogger('ProductAppRuntimeHostService');

function assertProductAppSessionContract(
  opened: Awaited<ReturnType<typeof productAppSessionAPI.open>>,
  expected: ProductAppRuntimeSessionMetadata,
  expectedAgentType: string,
): void {
  const actual = opened.metadata.customMetadata?.productAppRuntime;
  const expectedWorkId = expected.runtimeContext?.workLocator.workId;
  const actualWorkId =
    actual?.workId ?? actual?.runtimeContext?.workLocator.workId;
  const expectedChannelId = expected.hostSurfaceId;
  const actualChannelId = actual?.sessionChannel?.channelId;
  const violations = [
    opened.metadata.sessionId !== opened.sessionId
      ? `metadata session ${opened.metadata.sessionId} does not match ${opened.sessionId}`
      : null,
    opened.history.locator.session_id !== opened.sessionId
      ? `history locator ${opened.history.locator.session_id} does not match ${opened.sessionId}`
      : null,
    opened.metadata.agentType !== expectedAgentType
      ? `agent type is ${opened.metadata.agentType}, expected ${expectedAgentType}`
      : null,
    actual?.profile !== 'product-app-runtime'
      ? `profile is ${actual?.profile ?? 'missing'}, expected product-app-runtime`
      : null,
    actual?.appId !== expected.appId
      ? `app is ${actual?.appId ?? 'missing'}, expected ${expected.appId}`
      : null,
    actualWorkId !== expectedWorkId
      ? `Work is ${actualWorkId ?? 'missing'}, expected ${expectedWorkId ?? 'missing'}`
      : null,
    actualChannelId !== expectedChannelId
      ? `channel is ${actualChannelId ?? 'missing'}, expected ${expectedChannelId ?? 'missing'}`
      : null,
    actual?.sessionChannel?.role !== 'surface_chat'
      ? `channel role is ${actual?.sessionChannel?.role ?? 'missing'}, expected surface_chat`
      : null,
  ].filter((violation): violation is string => violation != null);
  if (violations.length > 0) {
    throw new Error(`Product App session contract violation: ${violations.join('; ')}`);
  }
}

function navigationIsCurrent(options: OpenProductAppRuntimeOptions): boolean {
  return options.isNavigationCurrent?.() !== false;
}

function productAppRuntimeDescriptor(metadata?: ProductAppRuntimeSessionMetadata): SessionDescriptor {
  return getProductAppRuntimeSessionDescriptor(
    getProductAppRuntimeAgentType(metadata),
  );
}

function validateCompositeInteraction(app: ProductAppHostSurface | ProductAppHostSurfaceMeta): void {
  const interaction = app.interaction;
  if (!interaction || interaction.mode !== 'composite') {
    return;
  }

  if (!interaction.chat) {
    throw new Error(`Product App host surface "${app.id}" uses composite runtime interaction but declares no chat backend`);
  }

  const chatBackendId = interaction.chat.backendId?.trim();
  if (!chatBackendId) {
    throw new Error(`Product App host surface "${app.id}" uses composite runtime interaction but declares no chat backend id`);
  }

  const backend = app.backends?.find(candidate => candidate.id === chatBackendId);
  if (!backend) {
    throw new Error(`Product App host surface declares chat backend "${chatBackendId}" but no matching backend binding exists`);
  }
  if (backend.kind !== 'agentComponent') {
    throw new Error(`Product App host surface chat backend "${chatBackendId}" must bind to an Agent Component`);
  }
  const agentComponentId = interaction.chat.agentComponentId?.trim() || backend.componentId.trim();
  if (!agentComponentId) {
    throw new Error(`Product App host surface chat backend "${chatBackendId}" does not declare an Agent Component id`);
  }
}

export async function ensureProductAppRuntimeSession(
  target: ProductAppRuntimeHostTarget,
  options: OpenProductAppRuntimeOptions = {}
): Promise<string | null> {
  if (!navigationIsCurrent(options)) return null;
  const app = target.hostSurface;
  validateCompositeInteraction(app);
  const scope = normalizeAppScope(options.scope ?? target.scope);

  const metadata = buildProductAppRuntimeMetadata(app, {
    intelligentApp: target.intelligentApp,
    entityId: options.entityId,
    locale: options.locale,
    scope,
    runtimeContext: options.runtimeContext ?? target.runtimeContext,
  });
  registerProductAppRuntimeToolCardManifests(metadata);
  const descriptor = productAppRuntimeDescriptor(metadata);
  const title = metadata.interactionTitle || metadata.appName;
  const workId = metadata.runtimeContext?.workLocator.workId;
  if (!workId) {
    throw new Error(`Product App host surface "${app.id}" has no Work binding`);
  }
  const opened = await productAppSessionAPI.open({
    workLocator: metadata.runtimeContext!.workLocator,
    appId: metadata.appId,
    channelId: metadata.hostSurfaceId,
    entityId: metadata.entityId,
    sessionName: title,
    agentType: getBackendAgentType(descriptor),
    customMetadata: {
      productAppRuntime: metadata,
    },
  });
  assertProductAppSessionContract(
    opened,
    metadata,
    getBackendAgentType(descriptor),
  );
  if (!navigationIsCurrent(options)) return null;
  await flowChatStore.hydrateWorkspaceSessionsMetadata(
    [opened.metadata],
    opened.history.executionWorkspacePath,
  );
  const navigationResult = await openWorkspaceSession(opened.sessionId, {
    context: options.context,
    navigationEpoch: options.navigationEpoch,
  });
  return navigationResult === 'opened' ? opened.sessionId : null;
}

export async function openProductAppRuntimeHost(
  target: ProductAppRuntimeHostTarget,
  options: OpenProductAppRuntimeOptions = {}
): Promise<void> {
  if (!navigationIsCurrent(options)) return;
  const scope = normalizeAppScope(options.scope ?? target.scope);
  const workspacePath = workspacePathFromAppScope(scope);
  const app = target.hostSurface;
  const runtimeContext = options.runtimeContext ?? target.runtimeContext;
  const context =
    options.context ??
    target.context ??
    { kind: 'work' as const, workId: runtimeContext.workLocator.workId };

  if (!isCompositeProductAppRuntimeHost(app)) {
    if (!navigationIsCurrent(options)) return;
    openWorkspaceScene(`app-surface:${app.id}` as WorkspaceSceneId, {
      workspacePath: workspacePath ?? null,
      appScope: scope,
      context,
      runtimeContext,
    });
    return;
  }

  try {
    const sessionId = await ensureProductAppRuntimeSession(target, {
      ...options,
      scope,
      context,
      runtimeContext,
    });
    if (!sessionId) return;
  } catch (error) {
    log.error('Failed to open Product App runtime', {
      appId: target.intelligentApp.appId,
      hostSurfaceId: app.id,
      error,
    });
    notificationService.error(error instanceof Error ? error.message : String(error));
    throw error;
  }
}
