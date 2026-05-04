import type { SessionProfile } from '../types';

export const deepResearchProfile: SessionProfile = {
  id: 'deep-research',

  matches(mode) {
    return mode?.toLowerCase() === 'deepresearch';
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
    dataAgent: 'deep-research',
  },

  topBar: {
    showContextNav: true,
    showWorkspaceName: true,
  },
};
