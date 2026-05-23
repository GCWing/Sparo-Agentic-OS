import type { SessionProfile } from '../types';

/** Prime Builder profile — covers agentic / Plan / debug / Team modes. */
export const codingProfile: SessionProfile = {
  id: 'coding',

  matches(mode) {
    if (!mode) return true; // default fallback
    const lower = mode.toLowerCase();
    return (
      lower === 'agentic' ||
      lower === 'plan' ||
      lower === 'debug' ||
      lower === 'team'
    );
  },

  layout: {
    showChat: true,
    defaultAuxPane: 'collapsed',
    chatCollapsible: true,
  },

  auxTabs: {
    // No auto-opened tabs; user opens editor/diff tabs via tool calls.
  },

  capabilities: {
    canSwitchAgents: true,
    showWelcomePanel: true,
    showDispatcherModelRoundUI: false,
  },

  workspaceScope: {
    kind: 'workspace',
  },

  theme: {
    dataAgent: 'coding',
  },

  topBar: {
    showContextNav: true,
    showWorkspaceName: true,
  },
};
