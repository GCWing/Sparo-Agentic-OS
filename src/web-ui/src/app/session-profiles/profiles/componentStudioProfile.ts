import type { SessionProfile } from '../types';

export const componentStudioProfile: SessionProfile = {
  id: 'component-studio',

  layout: {
    showChat: true,
    defaultAuxPane: 'visible',
    chatCollapsible: true,
  },

  auxTabs: {
    /**
     * Auto-open the Component Studio panel tab when this session becomes active.
     * `extra.componentId` is the optional Component package ID. The tab title is resolved by
     * the coordinator using i18n and passed through `extra.tabTitle`.
     */
    autoOpen(sessionId, extra) {
      return {
        type: 'component-studio',
        title: (extra?.tabTitle as string | undefined) ?? 'Component Studio',
        data: {
          sessionId,
          componentId: extra?.componentId,
          scope: extra?.scope,
        },
        metadata: {
          componentStudioSessionId: sessionId,
          appScope: extra?.scope,
        },
        duplicateCheckKey: `component-studio:${sessionId}`,
        replaceExisting: true,
      };
    },

    exclusiveTabTypes: ['component-studio'],
  },

  sidecarActions(sessionId, extra) {
    const duplicateCheckKey = `component-studio:${sessionId}`;
    return [
      {
        id: 'component-studio',
        labelKey: 'flowChatHeader.sidecar.componentStudio',
        defaultLabel: 'Component Studio',
        icon: 'app-window',
        order: 10,
        panel: {
          type: 'component-studio',
          title: (extra?.tabTitle as string | undefined) ?? 'Component Studio',
          data: {
            sessionId,
            componentId: extra?.componentId,
            scope: extra?.scope,
          },
          metadata: {
            componentStudioSessionId: sessionId,
            appScope: extra?.scope,
            duplicateCheckKey,
          },
          duplicateCheckKey,
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
    kind: 'global',
  },

  theme: {
    dataAgent: 'component-studio',
  },

  topBar: {
    showContextNav: true,
    showWorkspaceName: false,
  },
};
