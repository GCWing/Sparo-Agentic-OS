import type { SessionProfile } from '../types';

export const agentAppStudioProfile: SessionProfile = {
  id: 'agent-app-studio',

  layout: {
    showChat: true,
    defaultAuxPane: 'visible',
    chatCollapsible: true,
  },

  auxTabs: {
    /**
     * Auto-open the AgentAppStudio panel tab when this session becomes active.
     * `extra.appId` is the optional package ID. The tab title is resolved by
     * the coordinator using i18n and passed through `extra.tabTitle`.
     */
    autoOpen(sessionId, extra) {
      return {
        type: 'agent-app-studio',
        title: (extra?.tabTitle as string | undefined) ?? 'Agent App Builder',
        data: {
          sessionId,
          appId: extra?.appId,
        },
        metadata: {
          agentAppStudioSessionId: sessionId,
        },
        duplicateCheckKey: `agent-app-studio:${sessionId}`,
        replaceExisting: true,
      };
    },

    exclusiveTabTypes: ['agent-app-studio'],
  },

  sidecarActions(sessionId, extra) {
    const duplicateCheckKey = `agent-app-studio:${sessionId}`;
    return [
      {
        id: 'agent-app-studio',
        labelKey: 'flowChatHeader.sidecar.agentAppStudio',
        defaultLabel: 'Agent App Builder',
        icon: 'app-window',
        order: 10,
        panel: {
          type: 'agent-app-studio',
          title: (extra?.tabTitle as string | undefined) ?? 'Agent App Builder',
          data: {
            sessionId,
            appId: extra?.appId,
          },
          metadata: {
            agentAppStudioSessionId: sessionId,
            duplicateCheckKey,
          },
          duplicateCheckKey,
          replaceExisting: true,
        },
      },
    ];
  },

  capabilities: {
    canSwitchAgents: false,
    showWelcomePanel: true,
    showAgenticOsModelRoundUI: false,
  },

  workspaceScope: {
    kind: 'global',
  },

  theme: {
    dataAgent: 'agent-app-studio',
  },

  topBar: {
    showContextNav: true,
    showWorkspaceName: false,
  },
};
