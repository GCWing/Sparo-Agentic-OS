import type { SessionProfile } from '../types';

/** Runno profile — OS-native general execution without BitFun Coder mode switching. */
export const runnoProfile: SessionProfile = {
  id: 'runno',

  auxiliarySurface: {
    defaultVisibility: 'collapsed',
  },

  composer: {
    visibility: {
      showActionButtonWhenCollapsed: true,
      showActionButtonWhenActive: true,
      showActionButtonWhenProcessing: false,
    },
  },

  capabilities: {
    showWelcomePanel: true,
    showAgenticOsModelRoundUI: false,
  },

  workspaceScope: {
    kind: 'workspace',
  },

  theme: {
    dataAgent: 'runno',
  },

  topBar: {
    showContextNav: true,
    showWorkspaceName: true,
  },
};
