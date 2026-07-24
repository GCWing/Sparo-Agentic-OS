import type { SessionProfile } from '../types';

export const agenticOsProfile: SessionProfile = {
  id: 'agentic-os',

  auxiliarySurface: {
    defaultVisibility: 'collapsed',
  },

  capabilities: {
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
