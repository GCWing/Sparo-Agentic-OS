import type { SessionProfile } from '../types';

export const agentAppStudioProfile: SessionProfile = {
  id: 'agent-app-studio',

  matches(mode) {
    return mode?.toLowerCase() === 'agentappstudio';
  },

  layout: {
    showChat: true,
    defaultAuxPane: 'collapsed',
    chatCollapsible: true,
  },

  auxTabs: {},

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
