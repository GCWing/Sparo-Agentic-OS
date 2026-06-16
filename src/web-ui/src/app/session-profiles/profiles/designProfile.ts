import type { SessionProfile } from '../types';

export const designProfile: SessionProfile = {
  id: 'design',

  layout: {
    showChat: true,
    defaultAuxPane: 'collapsed',
    chatCollapsible: true,
  },

  auxTabs: {},

  capabilities: {
    canSwitchAgents: false,
    showWelcomePanel: true,
    showAgenticOsModelRoundUI: false,
  },

  workspaceScope: {
    kind: 'workspace',
  },

  theme: {
    dataAgent: 'design',
  },

  topBar: {
    showContextNav: true,
    showWorkspaceName: true,
  },
};
