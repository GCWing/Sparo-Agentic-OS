import type { SessionProfile } from '../types';

export const agenticOsProfile: SessionProfile = {
  id: 'agentic-os',

  layout: {
    showChat: true,
    defaultAuxPane: 'collapsed',
    chatCollapsible: false,
  },

  auxTabs: {
    // Agentic OS has no auto-opened tabs and no exclusive tab types.
  },

  capabilities: {
    canSwitchAgents: false,
    showWelcomePanel: false,
    showAgenticOsModelRoundUI: true,
  },

  workspaceScope: {
    kind: 'global',
  },

  theme: {
    dataAgent: 'agentic-os',
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
