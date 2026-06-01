import type { SessionProfile } from '../types';

export const deepResearchProfile: SessionProfile = {
  id: 'deep-research',

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
    dataAgent: 'deep-research',
  },

  topBar: {
    showContextNav: true,
    showWorkspaceName: true,
  },
};
