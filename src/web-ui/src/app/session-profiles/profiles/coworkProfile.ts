import type { SessionProfile } from '../types';

export const coworkProfile: SessionProfile = {
  id: 'cowork',

  layout: {
    showChat: true,
    defaultAuxPane: 'collapsed',
    chatCollapsible: true,
  },

  auxTabs: {},

  capabilities: {
    canSwitchAgents: false,
    showWelcomePanel: true,
    showDispatcherModelRoundUI: false,
  },

  workspaceScope: {
    kind: 'workspace',
  },

  theme: {
    dataAgent: 'cowork',
  },

  topBar: {
    showContextNav: true,
    showWorkspaceName: true,
  },
};
