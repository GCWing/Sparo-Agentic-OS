import type { SessionProfile } from '../types';

export const dispatcherProfile: SessionProfile = {
  id: 'dispatcher',

  matches(mode) {
    return mode?.toLowerCase() === 'dispatcher';
  },

  layout: {
    showChat: true,
    defaultAuxPane: 'collapsed',
    chatCollapsible: false,
  },

  auxTabs: {
    // Dispatcher has no auto-opened tabs and no exclusive tab types.
  },

  capabilities: {
    canSwitchModes: false,
    showWelcomePanel: false,
    showDispatcherModelRoundUI: true,
  },

  theme: {
    dataAgent: 'dispatcher',
    cssVars: {
      '--color-bg-flowchat': 'var(--color-bg-primary)',
    },
  },

  topBar: {
    showContextNav: false,
    showWorkspaceName: false,
  },
};
