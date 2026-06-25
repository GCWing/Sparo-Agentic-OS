import type {
  LiveAppWorkbenchSessionMetadata,
  LiveAppWorkbenchTabMetadata,
} from '@/shared/types/session-history';
import type {
  SessionProfile,
  SessionSidecarIconId,
  TabAutoOpenDescriptor,
} from '../types';

const WORKBENCH_EXCLUSIVE_TAB_TYPES = [
  'live-app-runner',
  'live-app-workbench-tab',
  'live-app-diagnostics',
] as const;

function getWorkbenchBinding(extra?: Record<string, unknown>): LiveAppWorkbenchSessionMetadata | null {
  const binding = extra?.liveAppWorkbench;
  if (!binding || typeof binding !== 'object') return null;
  return binding as LiveAppWorkbenchSessionMetadata;
}

function getVisibleWorkbenchTabs(
  binding: LiveAppWorkbenchSessionMetadata
): LiveAppWorkbenchTabMetadata[] {
  return binding.tabs.filter(tab => !tab.developerOnly);
}

function getDefaultWorkbenchTabs(
  binding: LiveAppWorkbenchSessionMetadata
): LiveAppWorkbenchTabMetadata[] {
  const visibleTabs = getVisibleWorkbenchTabs(binding);
  const defaultTabs = visibleTabs.filter(tab => tab.default);
  return defaultTabs.length > 0
    ? defaultTabs
    : visibleTabs.slice(0, 1);
}

function buildWorkbenchTabDescriptor(
  sessionId: string,
  binding: LiveAppWorkbenchSessionMetadata,
  tab: LiveAppWorkbenchTabMetadata
): TabAutoOpenDescriptor {
  const duplicateCheckKey = `live-app-workbench:${sessionId}:${tab.id}`;
  return {
    type: tab.type,
    title: tab.title,
    data: {
      ...(tab.data || {}),
      appId: binding.appId,
      sessionId,
      tabId: tab.id,
      route: tab.route,
      workspacePath: binding.workspacePath || undefined,
      scope: binding.scope,
      liveAppWorkbench: binding,
    },
    metadata: {
      boundSessionId: sessionId,
      liveAppWorkbenchSessionId: sessionId,
      liveAppWorkbenchAppId: binding.appId,
      liveAppWorkbenchTabId: tab.id,
      appScope: binding.scope,
      duplicateCheckKey,
    },
    duplicateCheckKey,
    replaceExisting: true,
  };
}

function buildDefaultWorkbenchTabDescriptors(
  sessionId: string,
  binding: LiveAppWorkbenchSessionMetadata
): TabAutoOpenDescriptor[] {
  return getDefaultWorkbenchTabs(binding)
    .map(tab => buildWorkbenchTabDescriptor(sessionId, binding, tab));
}

function getWorkbenchTabIcon(tab: LiveAppWorkbenchTabMetadata): SessionSidecarIconId {
  const hint = `${tab.id} ${tab.route ?? ''}`.toLowerCase();
  if (hint.includes('diagnostic')) {
    return 'activity';
  }
  if (hint.includes('preview') || hint.includes('play')) {
    return 'play';
  }

  switch (tab.type) {
    case 'live-app-diagnostics':
      return 'activity';
    case 'live-app-runner':
      return 'play';
    default:
      return 'app-window';
  }
}

function getWorkbenchActionId(tab: LiveAppWorkbenchTabMetadata): string {
  const safeId = tab.id.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return `live-app-workbench-${safeId || tab.type}`;
}

function createLiveAppWorkbenchProfile(
  id: 'live-app-workbench',
  dataAgent: string,
): SessionProfile {
  return {
    id,

    layout: {
      showChat: true,
      defaultAuxPane: 'visible',
      chatCollapsible: true,
    },

    auxTabs: {
      autoOpen(sessionId, extra) {
        const binding = getWorkbenchBinding(extra);
        return binding ? buildDefaultWorkbenchTabDescriptors(sessionId, binding) : null;
      },

      exclusiveTabTypes: WORKBENCH_EXCLUSIVE_TAB_TYPES,
    },

    sidecarActions(sessionId, extra) {
      const binding = getWorkbenchBinding(extra);
      if (!binding) return null;

      return getVisibleWorkbenchTabs(binding).map((tab, index) => ({
        id: getWorkbenchActionId(tab),
        label: tab.title,
        defaultLabel: tab.title || binding.appName,
        icon: getWorkbenchTabIcon(tab),
        order: 10 + index,
        panel: buildWorkbenchTabDescriptor(sessionId, binding, tab),
      }));
    },

    capabilities: {
      showWelcomePanel: false,
      showAgenticOsModelRoundUI: false,
    },

    workspaceScope: {
      kind: 'global',
    },

    theme: {
      dataAgent,
    },

    topBar: {
      showContextNav: true,
      showWorkspaceName: true,
    },
  };
}

export const liveAppWorkbenchProfile = createLiveAppWorkbenchProfile(
  'live-app-workbench',
  'live-app-workbench',
);
