import type { SessionProfile } from '../types';

export const coworkProfile: SessionProfile = {
  id: 'cowork',

  matches(mode) {
    return mode?.toLowerCase() === 'cowork';
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
    dataAgent: 'cowork',
  },

  topBar: {
    showContextNav: true,
    showWorkspaceName: true,
  },
};
