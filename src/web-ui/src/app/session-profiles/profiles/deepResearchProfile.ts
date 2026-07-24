import type { SessionProfile } from '../types';

export const deepResearchProfile: SessionProfile = {
  id: 'deep-research',

  auxiliarySurface: {
    defaultVisibility: 'collapsed',
  },

  capabilities: {
    showWelcomePanel: true,
    showAgenticOsModelRoundUI: false,
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
