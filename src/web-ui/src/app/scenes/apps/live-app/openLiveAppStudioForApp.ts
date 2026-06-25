import type { WorkspaceSurfaceContext } from '@/app/navigation/workspaceSurfaceTypes';
import { liveAppAPI } from '@/infrastructure/api/service-api/LiveAppAPI';
import type { LiveApp, LiveAppMeta } from '@/infrastructure/api/service-api/LiveAppAPI';
import { SESSION_DESCRIPTORS } from '@/flow_chat/domain/sessionDescriptor';
import { openBoundAgentSession } from '@/flow_chat/services/boundAgentSessionService';
import { useWorkStore } from '@/app/agentic-os/work/data/workStore';
import type { WorkScope } from '@/app/agentic-os/work/domain/workTypes';
import { createLogger } from '@/shared/utils/logger';
import {
  normalizeAppScope,
  systemAppScope,
  type AppScope,
  workspacePathFromAppScope,
} from '@/shared/types/app-scope';
import { resolveLiveAppMeta } from './liveAppI18n';
import { useLiveAppStore } from './liveAppStore';

const log = createLogger('OpenLiveAppStudioForApp');

export interface OpenLiveAppStudioForAppOptions {
  locale?: string | null;
  scope?: AppScope | null;
  theme?: string | null;
  openedFrom?: string;
  context?: WorkspaceSurfaceContext | null;
}

async function loadLiveApp(
  appOrId: LiveApp | LiveAppMeta | string,
  options: OpenLiveAppStudioForAppOptions,
): Promise<LiveApp | LiveAppMeta> {
  if (typeof appOrId !== 'string') {
    return appOrId;
  }
  const scope = normalizeAppScope(options.scope);
  return liveAppAPI.getLiveApp(
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

export async function openLiveAppStudioForApp(
  appOrId: LiveApp | LiveAppMeta | string,
  options: OpenLiveAppStudioForAppOptions = {},
): Promise<void> {
  const scope = normalizeAppScope(options.scope ?? systemAppScope());
  const workspacePath = workspacePathFromAppScope(scope);
  const app = await loadLiveApp(appOrId, { ...options, scope });
  const displayMeta = resolveLiveAppMeta(app, options.locale || undefined);
  const sessionName = buildSessionTitle(displayMeta.name || app.id);
  const appRef = { kind: 'live_app' as const, appId: app.id };
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

  void liveAppAPI.recordRecentLiveApp(app.id)
    .catch(error => log.warn('Failed to persist recent Live App', { appId: app.id, error }));

  const session = await openBoundAgentSession({
    descriptor: SESSION_DESCRIPTORS.liveAppStudio,
    sessionName,
    storageScope: 'agentic_os',
    binding: {
      schemaVersion: 1,
      intent: {
        agentType: 'LiveAppStudio',
        mode: 'edit',
      },
      subject: {
        kind: 'live-app',
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
        contentType: 'live-app-studio',
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
      useLiveAppStore.getState().bindSessionApp(session.sessionId, app.id);
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
