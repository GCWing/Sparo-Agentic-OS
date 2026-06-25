import type { SessionProfile } from '../types';
import type { AgentSessionBindingMetadata } from '@/shared/types/session-history';

function getBoundLiveAppBinding(extra?: Record<string, unknown>): AgentSessionBindingMetadata | undefined {
  const binding = extra?.agentSessionBinding as AgentSessionBindingMetadata | undefined;
  return binding?.subject.kind === 'live-app' ? binding : undefined;
}

function getBoundLiveAppId(extra?: Record<string, unknown>): string | undefined {
  const binding = getBoundLiveAppBinding(extra);
  if (binding) return binding.subject.id;

  const appId = extra?.appId;
  return typeof appId === 'string' && appId.trim() ? appId : undefined;
}

function getPanelTitle(extra?: Record<string, unknown>): string {
  const binding = getBoundLiveAppBinding(extra);
  return (
    binding?.surface?.title ||
    (extra?.tabTitle as string | undefined) ||
    binding?.subject.title ||
    'Live App Builder'
  );
}

export const liveAppStudioProfile: SessionProfile = {
  id: 'live-app-studio',

  layout: {
    showChat: true,
    defaultAuxPane: 'visible',
    chatCollapsible: true,
  },

  auxTabs: {
    /**
     * Auto-open the LiveAppStudio panel tab when this session becomes active.
     * `extra.appId` is the optional studio app ID from liveAppStore.
     * The tab title is resolved by the coordinator using the i18n key
     * 'common:liveAppStudio.panel.title' — passed via extra so the profile
     * stays free of i18n imports.
     */
    autoOpen(sessionId, extra) {
      const appId = getBoundLiveAppId(extra);
      const duplicateCheckKey = `live-app-studio:${sessionId}`;
      return {
        type: 'live-app-studio',
        title: getPanelTitle(extra),
        data: {
          sessionId,
          appId,
          scope: getBoundLiveAppBinding(extra)?.scope,
        },
        metadata: {
          liveAppStudioSessionId: sessionId,
          liveAppStudioAppId: appId,
          agentSessionBinding: extra?.agentSessionBinding,
          appScope: getBoundLiveAppBinding(extra)?.scope,
        },
        duplicateCheckKey,
        replaceExisting: true,
      };
    },

    exclusiveTabTypes: ['live-app-studio'],
  },

  sidecarActions(sessionId, extra) {
    const duplicateCheckKey = `live-app-studio:${sessionId}`;
    const appId = getBoundLiveAppId(extra);
    return [
      {
        id: 'live-app-studio',
        labelKey: 'flowChatHeader.sidecar.liveAppStudio',
        defaultLabel: 'Live App Builder',
        icon: 'app-window',
        order: 10,
        panel: {
          type: 'live-app-studio',
          title: getPanelTitle(extra),
          data: {
            sessionId,
            appId,
            scope: getBoundLiveAppBinding(extra)?.scope,
          },
          metadata: {
            liveAppStudioSessionId: sessionId,
            liveAppStudioAppId: appId,
            agentSessionBinding: extra?.agentSessionBinding,
            appScope: getBoundLiveAppBinding(extra)?.scope,
            duplicateCheckKey,
          },
          duplicateCheckKey,
          replaceExisting: true,
        },
      },
    ];
  },

  buildAgentContextHint(_session, binding) {
    if (binding.intent.agentType !== 'LiveAppStudio') return null;
    if (binding.intent.mode !== 'edit') return null;
    if (binding.subject.kind !== 'live-app') return null;

    const appId = binding.subject.id;
    const appName = binding.subject.title || appId;
    const scopeReminder =
      binding.scope.kind === 'workspace'
        ? `App scope: workspace (${binding.scope.workspacePath}).`
        : 'App scope: system App storage.';
    return {
      metadata: {
        agentSessionBinding: binding,
        liveAppStudioAppId: appId,
        appScope: binding.scope,
      },
      systemReminder: [
        `You are editing existing Live App "${appName}" (app_id=${appId}).`,
        scopeReminder,
        'Do not call InitLiveApp unless the user explicitly asks for a new app.',
        'Read and edit only this app source files, meta.json, and package.json.',
        `After source edits, run LiveAppRecompile with app_id=${appId}, then LiveAppRuntimeProbe with app_id=${appId}.`,
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
    dataAgent: 'live-app-studio',
  },

  topBar: {
    showContextNav: true,
    showWorkspaceName: true,
  },
};
