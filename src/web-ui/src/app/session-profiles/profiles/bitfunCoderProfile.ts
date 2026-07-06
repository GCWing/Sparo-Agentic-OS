import type { SessionProfile } from '../types';

/** BitFun Coder profile covers bitfun-coder / bitfun-plan / bitfun-debug / bitfun-team modes. */
export const bitfunCoderProfile: SessionProfile = {
  id: 'bitfun-coder',

  layout: {
    showChat: true,
    defaultAuxPane: 'collapsed',
    chatCollapsible: true,
  },

  auxTabs: {
    // No auto-opened tabs; user opens editor/diff tabs via tool calls.
  },

  composer: {
    visibility: {
      showActionButtonWhenCollapsed: true,
      showActionButtonWhenActive: true,
      showActionButtonWhenProcessing: false,
    },
    agentSwitching: {
      mode: 'in-session',
      source: 'session-policy',
      includeDefaultAgent: false,
      showCurrentAgent: true,
      order: ['bitfun-plan', 'bitfun-debug', 'bitfun-team'],
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
    dataAgent: 'bitfun-coder',
  },

  topBar: {
    showContextNav: true,
    showWorkspaceName: true,
  },
};
