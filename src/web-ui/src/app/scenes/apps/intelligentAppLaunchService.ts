import { useWorkStore } from '@/app/agentic-os/work/data/workStore';
import { productAppWorkRef } from '@/app/agentic-os/work/domain/productAppRefs';
import type { WorkRecord } from '@/app/agentic-os/work/domain/workTypes';
import { openWork } from '@/app/agentic-os/work/navigation/openWork';
import { useSessionModeStore, type SessionMode } from '@/app/stores/sessionModeStore';
import { resolveSessionTypeDefinitionForDescriptor } from '@/app/session-profiles';
import { descriptorFromAgentType, getBackendAgentType } from '@/flow_chat/domain/sessionDescriptor';
import type { ActiveAppRef } from '@/infrastructure/api/service-api/IntelligentAppAPI';
import {
  normalizeAppScope,
  systemAppScope,
  type AppScope,
  workScopeFromAppScope,
} from '@/shared/types/app-scope';
import { createAndOpenAppBuilder } from './app-builder/openAppBuilderSession';
import { openProductAppRuntime } from './product-app-runtime/productAppRuntimeService';

export interface LaunchIntelligentAppOptions {
  scope?: AppScope | null;
  title: string;
  objective?: string;
  /** Resume the most recent compatible Work unless the user explicitly asks for a new one. */
  workMode?: 'resume' | 'create';
}

function agentTypeFor(app: ActiveAppRef): string | null {
  const launch = app.runtime.launch;
  if (launch?.kind === 'agentSession') return launch.agentType || launch.targetId;
  return null;
}

async function openAgentAppWork(
  app: ActiveAppRef,
  scope: AppScope,
  title: string,
  objective: string,
  agentType: string,
  workMode: 'resume' | 'create',
): Promise<WorkRecord> {
  const descriptor = descriptorFromAgentType(agentType);
  const displayMode = resolveSessionTypeDefinitionForDescriptor(descriptor).lifecycle.displayMode;
  useSessionModeStore.getState().setMode(displayMode as SessionMode);

  const appRef = productAppWorkRef(app);
  const request = {
    app: appRef,
    intent: 'use' as const,
    title,
    objective,
    appRefs: [{ app: appRef, role: 'executor' as const }],
    scope: workScopeFromAppScope(scope),
    workspacePath: scope.kind === 'workspace' ? scope.workspacePath : undefined,
    visibility: 'primary' as const,
    primarySurfacePolicy: 'work_session' as const,
    assignment: {
      kind: 'agent' as const,
      agentType: getBackendAgentType(descriptor),
    },
  };
  const createExplicitMultipleWork = app.runtime.workMultiplicity === 'multiple'
    && workMode === 'create';
  const work = createExplicitMultipleWork
    ? await useWorkStore.getState().createWork({
        kind: 'app_workflow',
        title,
        objective,
        subject: { kind: 'app', app: appRef, intent: 'use' },
        appRefs: request.appRefs,
        scope: request.scope,
        workspacePath: request.workspacePath,
        visibility: request.visibility,
        primarySurfacePolicy: request.primarySurfacePolicy,
        assignment: request.assignment,
        titleState: { source: 'template', locked: false },
      })
    : (await useWorkStore.getState().resolveAppWork(request)).work;
  await openWork(work);
  return work;
}

/** Launches exactly the immutable Release selected by Activation. */
export async function launchActiveIntelligentApp(
  app: ActiveAppRef,
  options: LaunchIntelligentAppOptions,
): Promise<void> {
  const requestedScope = normalizeAppScope(options.scope ?? systemAppScope());
  const launch = app.runtime.launch;
  if (launch?.kind === 'appBuilder') {
    await createAndOpenAppBuilder({ scope: requestedScope });
    return;
  }
  const scope = app.runtime.workMultiplicity === 'singleton'
    && launch?.scopeRequirement !== 'workspaceRequired'
    ? systemAppScope()
    : requestedScope;
  const title = options.title.trim() || app.appId;
  const objective = options.objective?.trim() || title;
  if (launch?.scopeRequirement === 'workspaceRequired' && scope.kind !== 'workspace') {
    throw new Error(`App ${app.appId} requires a workspace scope`);
  }
  const agentType = agentTypeFor(app);

  if (agentType) {
    await openAgentAppWork(app, scope, title, objective, agentType, options.workMode ?? 'resume');
    return;
  }
  if (launch?.kind === 'applicationSurface') {
    await openProductAppRuntime(app, {
      scope,
      title,
      objective,
      workMode: options.workMode ?? 'resume',
    });
    return;
  }
  throw new Error(`App ${app.appId} Release ${app.releaseId} has no supported launch target`);
}
