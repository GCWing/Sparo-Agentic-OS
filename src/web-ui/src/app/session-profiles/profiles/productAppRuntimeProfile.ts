import type {
  ProductAppRuntimeSessionMetadata,
  ProductAppRuntimeTabMetadata,
} from '@/shared/types/session-history';
import type {
  SessionProfile,
  SessionSidecarIconId,
  TabAutoOpenDescriptor,
} from '../types';

const RUNTIME_EXCLUSIVE_TAB_TYPES = ['product-app-runtime'] as const;

function getRuntimeBinding(extra?: Record<string, unknown>): ProductAppRuntimeSessionMetadata | null {
  const binding = extra?.productAppRuntime;
  if (!binding || typeof binding !== 'object') return null;
  return binding as ProductAppRuntimeSessionMetadata;
}

function getVisibleRuntimeTabs(
  binding: ProductAppRuntimeSessionMetadata
): ProductAppRuntimeTabMetadata[] {
  return binding.tabs.filter(tab => !tab.developerOnly);
}

function getDefaultRuntimeTabs(
  binding: ProductAppRuntimeSessionMetadata
): ProductAppRuntimeTabMetadata[] {
  const visibleTabs = getVisibleRuntimeTabs(binding);
  const defaultTabs = visibleTabs.filter(tab => tab.default);
  return defaultTabs.length > 0
    ? defaultTabs
    : visibleTabs.slice(0, 1);
}

function buildRuntimeTabDescriptor(
  sessionId: string,
  binding: ProductAppRuntimeSessionMetadata,
  tab: ProductAppRuntimeTabMetadata
): TabAutoOpenDescriptor {
  const runtimeContext = binding.runtimeContext;
  const identityParts = [
    sessionId,
    runtimeContext?.workId,
    runtimeContext?.runtimeInstanceId,
  ].filter((value): value is string => Boolean(value));
  const duplicateCheckKey = tab.sidecar?.actionId
    ? `${tab.sidecar.actionId}:${identityParts.join(':')}`
    : `product-app-runtime:${sessionId}:${tab.id}`;
  return {
    type: tab.type,
    title: tab.title,
    data: {
      ...(tab.data || {}),
      appId: binding.hostSurfaceId,
      productAppId: binding.appId,
      sessionId,
      tabId: tab.id,
      route: tab.route,
      workspacePath: binding.workspacePath || undefined,
      scope: binding.scope,
      productAppRuntime: binding,
    },
    metadata: {
      boundSessionId: sessionId,
      productAppRuntimeSessionId: sessionId,
      productAppRuntimeAppId: binding.appId,
      productAppRuntimeHostSurfaceId: binding.hostSurfaceId,
      productAppRuntimeTabId: tab.id,
      appScope: binding.scope,
      duplicateCheckKey,
    },
    duplicateCheckKey,
    replaceExisting: true,
    targetGroup: tab.sidecar?.targetGroup,
  };
}

function buildDefaultRuntimeTabDescriptors(
  sessionId: string,
  binding: ProductAppRuntimeSessionMetadata
): TabAutoOpenDescriptor[] {
  return getDefaultRuntimeTabs(binding)
    .map(tab => buildRuntimeTabDescriptor(sessionId, binding, tab));
}

function getRuntimeTabIcon(tab: ProductAppRuntimeTabMetadata): SessionSidecarIconId {
  return tab.sidecar?.icon ?? 'play';
}

function getRuntimeActionId(tab: ProductAppRuntimeTabMetadata): string {
  if (tab.sidecar?.actionId) {
    return tab.sidecar.actionId;
  }
  const safeId = tab.id.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return `product-app-runtime-${safeId || tab.type}`;
}

function createProductAppRuntimeProfile(
  id: 'product-app-runtime',
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
        const binding = getRuntimeBinding(extra);
        return binding ? buildDefaultRuntimeTabDescriptors(sessionId, binding) : null;
      },

      exclusiveTabTypes: RUNTIME_EXCLUSIVE_TAB_TYPES,
    },

    sidecarActions(sessionId, extra) {
      const binding = getRuntimeBinding(extra);
      if (!binding) return null;

      return getVisibleRuntimeTabs(binding).map((tab, index) => ({
        id: getRuntimeActionId(tab),
        label: tab.title,
        defaultLabel: tab.title || binding.appName,
        icon: getRuntimeTabIcon(tab),
        order: tab.sidecar?.order ?? 10 + index,
        availability: tab.sidecar?.availability,
        panel: buildRuntimeTabDescriptor(sessionId, binding, tab),
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

export const productAppRuntimeProfile = createProductAppRuntimeProfile(
  'product-app-runtime',
  'product-app-runtime',
);
