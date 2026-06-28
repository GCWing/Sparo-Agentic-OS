import type { WorkspaceSurfaceContext } from '@/app/navigation/workspaceSurfaceTypes';
import { surfaceComponentAPI } from '@/infrastructure/api/service-api/SurfaceComponentAPI';
import type { SurfaceComponent, SurfaceComponentMeta } from '@/infrastructure/api/service-api/SurfaceComponentAPI';
import { SESSION_DESCRIPTORS } from '@/flow_chat/domain/sessionDescriptor';
import { openBoundAgentSession } from '@/flow_chat/services/boundAgentSessionService';
import { useWorkStore } from '@/app/agentic-os/work/data/workStore';
import type { WorkScope } from '@/app/agentic-os/work/domain/workTypes';
import { resolveProductAppWorkRef } from '@/app/scenes/apps/productAppCatalog';
import { createLogger } from '@/shared/utils/logger';
import {
  normalizeAppScope,
  systemAppScope,
  type AppScope,
  workspacePathFromAppScope,
} from '@/shared/types/app-scope';
import { resolveSurfaceComponentMeta } from './surfaceComponentI18n';
import { useSurfaceComponentStore } from './surfaceComponentStore';

const log = createLogger('OpenAppStudioForApp');

export interface OpenAppStudioForAppOptions {
  locale?: string | null;
  scope?: AppScope | null;
  theme?: string | null;
  openedFrom?: string;
  context?: WorkspaceSurfaceContext | null;
}

async function loadSurfaceComponent(
  appOrId: SurfaceComponent | SurfaceComponentMeta | string,
  options: OpenAppStudioForAppOptions,
): Promise<SurfaceComponent | SurfaceComponentMeta> {
  if (typeof appOrId !== 'string') {
    return appOrId;
  }
  const scope = normalizeAppScope(options.scope);
  return surfaceComponentAPI.getSurfaceComponent(
    appOrId,
    options.theme || undefined,
    workspacePathFromAppScope(scope),
  );
}

function buildSessionTitle(appName: string): string {
  return `Edit ${appName}`;
}

function workScopeFromAppScope(scope: AppScope): WorkScope {
  const workspacePath = workspacePathFromAppScope(scope);
  return workspacePath ? { kind: 'workspace', workspacePath } : { kind: 'system' };
}

export async function openAppStudioForProductApp(
  appOrId: SurfaceComponent | SurfaceComponentMeta | string,
  options: OpenAppStudioForAppOptions = {},
): Promise<void> {
  const scope = normalizeAppScope(options.scope ?? systemAppScope());
  const workspacePath = workspacePathFromAppScope(scope);
  const app = await loadSurfaceComponent(appOrId, { ...options, scope });
  const displayMeta = resolveSurfaceComponentMeta(app, options.locale || undefined);
  const sessionName = buildSessionTitle(displayMeta.name || app.id);
  const appRef = await resolveProductAppWorkRef(app.id);
  const { work } = await useWorkStore.getState().resolveAppWork({
    app: appRef,
    intent: 'edit',
    title: sessionName,
    objective: sessionName,
    scope: workScopeFromAppScope(scope),
    visibility: 'primary',
    primarySurfacePolicy: 'work_center',
    assignment: {
      kind: 'application',
      applicationId: app.id,
    },
    appRefs: [
      { app: appRef, role: 'executor' },
    ],
  });

  void surfaceComponentAPI.recordRecentSurfaceComponent(app.id)
    .catch(error => log.warn('Failed to persist recent Product App', { appId: app.id, error }));

  const session = await openBoundAgentSession({
    descriptor: SESSION_DESCRIPTORS.appStudio,
    sessionName,
    storageScope: 'agentic_os',
    binding: {
      schemaVersion: 1,
      intent: {
        agentType: 'AppStudio',
        mode: 'edit',
      },
      subject: {
        kind: 'product-app',
        id: app.id,
        title: displayMeta.name || app.id,
        version: app.version,
        revision: app.runtime?.source_revision,
        data: {
          category: app.category,
          icon: app.icon,
        },
      },
      surface: {
        contentType: 'app-studio',
        title: sessionName,
        data: {
          appId: app.id,
          scope,
        },
      },
      scope,
      workspacePath: workspacePath ?? null,
      openedFrom: options.openedFrom,
      updatedAt: Date.now(),
    },
    context: { kind: 'work', workId: work.id },
    onOpened: (session) => {
      useSurfaceComponentStore.getState().bindSessionApp(session.sessionId, app.id);
    },
  });
  if (session) {
    await useWorkStore.getState().linkSessionToWork({
      workId: work.id,
      sessionId: session.sessionId,
      workspacePath,
      surface: { kind: 'agent_session', sessionId: session.sessionId },
      setPrimary: true,
    });
  }
}
