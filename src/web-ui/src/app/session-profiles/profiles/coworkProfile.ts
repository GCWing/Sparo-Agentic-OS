import type { SessionProfile } from '../types';

export const coworkProfile: SessionProfile = {
  id: 'cowork',

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
    dataAgent: 'cowork',
  },

  topBar: {
    showContextNav: true,
    showWorkspaceName: true,
  },
};
