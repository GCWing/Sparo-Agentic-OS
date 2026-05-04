import type { SessionProfile } from '../types';

/** Coding App profile — covers agentic / Plan / debug / Team modes. */
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
    canSwitchModes: true,
    showWelcomePanel: true,
    showDispatcherModelRoundUI: false,
  },

  theme: {
    dataAgent: 'coding',
  },

  topBar: {
    showContextNav: true,
    showWorkspaceName: true,
  },
};
