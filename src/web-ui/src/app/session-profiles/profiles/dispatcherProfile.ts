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
      '--ds-chat-surface': 'var(--ds-color-bg-app)',
      '--color-bg-flowchat': 'var(--ds-color-bg-app)',
    },
  },

  topBar: {
    showContextNav: false,
    showWorkspaceName: false,
  },
};
