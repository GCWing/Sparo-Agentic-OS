import type { SessionProfile } from '../types';

export const agentAppStudioProfile: SessionProfile = {
  id: 'agent-app-studio',

  matches(mode) {
    return mode?.toLowerCase() === 'agentappstudio';
  },

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
        title: (extra?.tabTitle as string | undefined) ?? 'Agent App Studio',
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

  capabilities: {
    canSwitchModes: false,
    showWelcomePanel: true,
    showDispatcherModelRoundUI: false,
  },

  theme: {
    dataAgent: 'agent-app-studio',
  },

  topBar: {
    showContextNav: true,
    showWorkspaceName: false,
  },
};
