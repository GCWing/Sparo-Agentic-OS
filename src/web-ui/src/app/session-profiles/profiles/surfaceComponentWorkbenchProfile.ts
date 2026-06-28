import type {
  SurfaceComponentWorkbenchSessionMetadata,
  SurfaceComponentWorkbenchTabMetadata,
} from '@/shared/types/session-history';
import type {
  SessionProfile,
  SessionSidecarIconId,
  TabAutoOpenDescriptor,
} from '../types';

const WORKBENCH_EXCLUSIVE_TAB_TYPES = [
  'surface-component-runner',
  'surface-component-workbench-tab',
  'surface-component-diagnostics',
] as const;

function getWorkbenchBinding(extra?: Record<string, unknown>): SurfaceComponentWorkbenchSessionMetadata | null {
  const binding = extra?.surfaceComponentWorkbench;
  if (!binding || typeof binding !== 'object') return null;
  return binding as SurfaceComponentWorkbenchSessionMetadata;
}

function getVisibleWorkbenchTabs(
  binding: SurfaceComponentWorkbenchSessionMetadata
): SurfaceComponentWorkbenchTabMetadata[] {
  return binding.tabs.filter(tab => !tab.developerOnly);
}

function getDefaultWorkbenchTabs(
  binding: SurfaceComponentWorkbenchSessionMetadata
): SurfaceComponentWorkbenchTabMetadata[] {
  const visibleTabs = getVisibleWorkbenchTabs(binding);
  const defaultTabs = visibleTabs.filter(tab => tab.default);
  return defaultTabs.length > 0
    ? defaultTabs
    : visibleTabs.slice(0, 1);
}

function buildWorkbenchTabDescriptor(
  sessionId: string,
  binding: SurfaceComponentWorkbenchSessionMetadata,
  tab: SurfaceComponentWorkbenchTabMetadata
): TabAutoOpenDescriptor {
  const duplicateCheckKey = `surface-component-workbench:${sessionId}:${tab.id}`;
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
      surfaceComponentWorkbench: binding,
    },
    metadata: {
      boundSessionId: sessionId,
      surfaceComponentWorkbenchSessionId: sessionId,
      surfaceComponentWorkbenchAppId: binding.appId,
      surfaceComponentWorkbenchTabId: tab.id,
      appScope: binding.scope,
      duplicateCheckKey,
    },
    duplicateCheckKey,
    replaceExisting: true,
  };
}

function buildDefaultWorkbenchTabDescriptors(
  sessionId: string,
  binding: SurfaceComponentWorkbenchSessionMetadata
): TabAutoOpenDescriptor[] {
  return getDefaultWorkbenchTabs(binding)
    .map(tab => buildWorkbenchTabDescriptor(sessionId, binding, tab));
}

function getWorkbenchTabIcon(tab: SurfaceComponentWorkbenchTabMetadata): SessionSidecarIconId {
  const hint = `${tab.id} ${tab.route ?? ''}`.toLowerCase();
  if (hint.includes('diagnostic')) {
    return 'activity';
  }
  if (hint.includes('preview') || hint.includes('play')) {
    return 'play';
  }

  switch (tab.type) {
    case 'surface-component-diagnostics':
      return 'activity';
    case 'surface-component-runner':
      return 'play';
    default:
      return 'app-window';
  }
}

function getWorkbenchActionId(tab: SurfaceComponentWorkbenchTabMetadata): string {
  const safeId = tab.id.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return `surface-component-workbench-${safeId || tab.type}`;
}

function createSurfaceComponentWorkbenchProfile(
  id: 'surface-component-workbench',
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

export const surfaceComponentWorkbenchProfile = createSurfaceComponentWorkbenchProfile(
  'surface-component-workbench',
  'surface-component-workbench',
);
