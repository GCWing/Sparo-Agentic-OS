import type { SessionProfile } from '../types';

export const designProfile: SessionProfile = {
  id: 'design',

  matches(mode) {
    return mode?.toLowerCase() === 'design';
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
    dataAgent: 'design',
  },

  topBar: {
    showContextNav: true,
    showWorkspaceName: true,
  },
};
