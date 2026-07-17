import type { SessionProfile } from '../types';

/** System-owned, app-lifetime settings conversation embedded inside Settings. */
export const settingsProfile: SessionProfile = {
  id: 'settings',

  layout: {
    showChat: true,
    defaultAuxPane: 'collapsed',
    chatCollapsible: false,
  },

  auxTabs: {},

  composer: {
    visibility: {
      showActionButtonWhenCollapsed: false,
      showActionButtonWhenActive: false,
      showActionButtonWhenProcessing: false,
    },
    agentSwitching: { mode: 'disabled' },
    builtIns: {
      'attach-context': 'hidden',
      'attach-image': 'hidden',
      skills: 'hidden',
      btw: 'hidden',
      goal: 'hidden',
      compact: 'hidden',
      init: 'hidden',
      'prompt-template': 'hidden',
    },
    providers: [],
    placeholderKey: 'settingsPlaceholder',
    showModelSelector: false,
    showVoiceInput: false,
    showWorkspaceMeta: false,
    showContextUsage: false,
    allowContextInput: false,
  },

  messageActions: {
    showUserEdit: false,
    showUserRecovery: false,
    showUserRollback: false,
    showAssistantFork: false,
    showAssistantExport: false,
  },

  capabilities: {
    showWelcomePanel: true,
    showAgenticOsModelRoundUI: false,
    autoTitle: false,
    modelSelection: 'runtime-owned',
  },

  workspaceScope: {
    kind: 'global',
  },

  theme: {
    dataAgent: 'settings',
  },

  topBar: {
    showContextNav: false,
    showWorkspaceName: false,
  },
};
