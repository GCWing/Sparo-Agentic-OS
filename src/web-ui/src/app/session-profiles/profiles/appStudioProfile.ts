import type { SessionProfile } from '../types';
import type { AgentSessionBindingMetadata } from '@/shared/types/session-history';

function getBoundAppStudioBinding(extra?: Record<string, unknown>): AgentSessionBindingMetadata | undefined {
  const binding = extra?.agentSessionBinding as AgentSessionBindingMetadata | undefined;
  return binding?.subject.kind === 'product-app' ? binding : undefined;
}

function getBoundAppStudioAppId(extra?: Record<string, unknown>): string | undefined {
  const binding = getBoundAppStudioBinding(extra);
  if (binding) return binding.subject.id;

  const appId = extra?.appId;
  return typeof appId === 'string' && appId.trim() ? appId : undefined;
}

function getPanelTitle(extra?: Record<string, unknown>): string {
  const binding = getBoundAppStudioBinding(extra);
  return (
    binding?.surface?.title ||
    (extra?.tabTitle as string | undefined) ||
    binding?.subject.title ||
    'App Studio'
  );
}

export const appStudioProfile: SessionProfile = {
  id: 'app-studio',

  layout: {
    showChat: true,
    defaultAuxPane: 'visible',
    chatCollapsible: true,
  },

  auxTabs: {
    /**
     * Auto-open the App Studio panel tab when this session becomes active.
     * `extra.appId` is the optional Product App ID from the app surface runtime store.
     */
    autoOpen(sessionId, extra) {
      const appId = getBoundAppStudioAppId(extra);
      const duplicateCheckKey = `app-studio:${sessionId}`;
      return {
        type: 'app-studio',
        title: getPanelTitle(extra),
        data: {
          sessionId,
          appId,
          scope: getBoundAppStudioBinding(extra)?.scope,
        },
        metadata: {
          appStudioSessionId: sessionId,
          appStudioAppId: appId,
          agentSessionBinding: extra?.agentSessionBinding,
          appScope: getBoundAppStudioBinding(extra)?.scope,
        },
        duplicateCheckKey,
        replaceExisting: true,
      };
    },

    exclusiveTabTypes: ['app-studio'],
  },

  sidecarActions(sessionId, extra) {
    const duplicateCheckKey = `app-studio:${sessionId}`;
    const appId = getBoundAppStudioAppId(extra);
    return [
      {
        id: 'app-studio',
        labelKey: 'flowChatHeader.sidecar.appStudio',
        defaultLabel: 'App Studio',
        icon: 'app-window',
        order: 10,
        panel: {
          type: 'app-studio',
          title: getPanelTitle(extra),
          data: {
            sessionId,
            appId,
            scope: getBoundAppStudioBinding(extra)?.scope,
          },
          metadata: {
            appStudioSessionId: sessionId,
            appStudioAppId: appId,
            agentSessionBinding: extra?.agentSessionBinding,
            appScope: getBoundAppStudioBinding(extra)?.scope,
            duplicateCheckKey,
          },
          duplicateCheckKey,
          replaceExisting: true,
        },
      },
    ];
  },

  buildAgentContextHint(_session, binding) {
    if (binding.intent.agentType !== 'AppStudio') return null;
    if (binding.intent.mode !== 'edit') return null;
    if (binding.subject.kind !== 'product-app') return null;

    const appId = binding.subject.id;
    const appName = binding.subject.title || appId;
    const scopeReminder =
      binding.scope.kind === 'workspace'
        ? `App scope: workspace (${binding.scope.workspacePath}).`
        : 'App scope: system App storage.';
    return {
      metadata: {
        agentSessionBinding: binding,
        appStudioAppId: appId,
        appScope: binding.scope,
      },
      systemReminder: [
        `You are editing existing Product App "${appName}" (app_id=${appId}).`,
        scopeReminder,
        'Do not call CreateProductApp unless the user explicitly asks for a new app.',
        'Read and edit only this Product App package: app.json, app.lock.json, work-objects, components, and tests.',
        'After package edits, validate the package contract and run the narrowest relevant checks for the touched runtime or UI code.',
      ].join('\n'),
    };
  },

  capabilities: {
    showWelcomePanel: false,
    showAgenticOsModelRoundUI: false,
  },

  workspaceScope: {
    kind: 'global',
  },

  theme: {
    dataAgent: 'app-studio',
  },

  topBar: {
    showContextNav: true,
    showWorkspaceName: true,
  },
};
