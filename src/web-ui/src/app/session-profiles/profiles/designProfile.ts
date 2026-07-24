import type { SessionProfile } from '../types';

export const designProfile: SessionProfile = {
  id: 'design',

  auxiliarySurface: {
    defaultVisibility: 'collapsed',
  },

  sidecarActions(sessionId, extra) {
    const workspacePath = extra?.workspacePath as string | undefined;
    return [
      {
        id: 'design-artifacts',
        labelKey: 'flowChatHeader.sidecar.designs',
        defaultLabel: 'Designs',
        icon: 'palette',
        order: 10,
        panel: {
          type: 'design-artifacts-browser',
          title: 'Designs',
          data: { workspacePath },
          metadata: {
            boundSessionId: sessionId,
            duplicateCheckKey: 'design-artifacts-browser',
          },
          duplicateCheckKey: 'design-artifacts-browser',
          replaceExisting: true,
        },
      },
      {
        id: 'design-tokens',
        labelKey: 'flowChatHeader.sidecar.designTokens',
        defaultLabel: 'Design Tokens',
        icon: 'settings',
        order: 20,
        panel: {
          type: 'design-tokens-studio',
          title: 'Design Tokens',
          data: { workspacePath },
          metadata: {
            boundSessionId: sessionId,
            duplicateCheckKey: 'design-tokens-studio',
          },
          duplicateCheckKey: 'design-tokens-studio',
          replaceExisting: true,
        },
      },
    ];
  },

  capabilities: {
    showWelcomePanel: true,
    showAgenticOsModelRoundUI: false,
  },

  workspaceScope: {
    kind: 'workspace',
  },

  theme: {
    dataAgent: 'design',
  },

  topBar: {
    showContextNav: true,
    showWorkspaceName: true,
  },
};
