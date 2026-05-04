import type { SessionProfile } from '../types';

export const liveAppStudioProfile: SessionProfile = {
  id: 'live-app-studio',

  matches(mode) {
    return mode?.toLowerCase() === 'liveappstudio';
  },

  layout: {
    showChat: true,
    defaultAuxPane: 'visible',
    chatCollapsible: true,
  },

  auxTabs: {
    /**
     * Auto-open the LiveAppStudio panel tab when this session becomes active.
     * `extra.appId` is the optional studio app ID from liveAppStore.
     * The tab title is resolved by the coordinator using the i18n key
     * 'common:liveAppStudio.panel.title' — passed via extra so the profile
     * stays free of i18n imports.
     */
    autoOpen(sessionId, extra) {
      return {
        type: 'live-app-studio',
        title: (extra?.tabTitle as string | undefined) ?? 'Live App Studio',
        data: {
          sessionId,
          appId: extra?.appId,
        },
        metadata: {
          liveAppStudioSessionId: sessionId,
        },
        duplicateCheckKey: `live-app-studio:${sessionId}`,
        replaceExisting: true,
      };
    },

    exclusiveTabTypes: ['live-app-studio'],
  },

  capabilities: {
    canSwitchModes: false,
    showWelcomePanel: false,
    showDispatcherModelRoundUI: false,
  },

  theme: {
    dataAgent: 'live-app-studio',
  },

  topBar: {
    showContextNav: true,
    showWorkspaceName: true,
  },
};
