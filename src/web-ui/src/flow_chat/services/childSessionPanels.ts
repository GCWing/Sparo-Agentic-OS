import { i18nService } from '@/infrastructure/i18n';
import { appManager } from '@/app/services/AppManager';
import { useWorkspaceSurfaceStore } from '@/app/navigation/workspaceSurfaceStore';
import { createTab } from '@/shared/utils/tabUtils';
import type { PanelContent } from '@/app/components/panels/base/types';
import { useAgentCanvasStore } from '@/app/components/panels/content-canvas/stores';
import type { CanvasTab } from '@/app/components/panels/content-canvas/types';
import { flowChatStore } from '../store/FlowChatStore';
import { flowChatManager } from './FlowChatManager';
import { syncSessionToModernStore } from './storeSync';
import { isSystemAgenticOsSession } from '../domain/sessionDescriptor';

export const SIDE_THREAD_SESSION_PANEL_TYPE = 'btw-session' as const;
export type ChildSessionPanelType = typeof SIDE_THREAD_SESSION_PANEL_TYPE;
export type ChildSessionPanelVariant = 'btw';

export interface ChildSessionPanelData {
  childSessionId: string;
  parentSessionId: string;
  workspacePath?: string;
  variant?: ChildSessionPanelVariant;
}

export interface ChildSessionPanelMetadata {
  duplicateCheckKey: string;
  childSessionId: string;
  parentSessionId: string;
  contentRole: 'btw-session';
  variant: ChildSessionPanelVariant;
}

type AgentCanvasState = ReturnType<typeof useAgentCanvasStore.getState>;

const getChildSessionDuplicateKey = (
  childSessionId: string,
  variant: ChildSessionPanelVariant
) => `${variant}-session-${childSessionId}`;

const resolveChildSessionTitle = (
  childSessionId: string,
  _variant: ChildSessionPanelVariant
): string => {
  const session = flowChatStore.getState().sessions.get(childSessionId);
  const title = session?.title?.trim();
  if (title) return title;
  return i18nService.t('flow-chat:btw.threadLabel', { defaultValue: 'Side thread' });
};

export const isChildSessionPanelContent = (content: PanelContent | null | undefined): boolean =>
  content?.type === SIDE_THREAD_SESSION_PANEL_TYPE;

export const buildChildSessionPanelContent = (
  childSessionId: string,
  parentSessionId: string,
  workspacePath: string | undefined,
  variant: ChildSessionPanelVariant
): PanelContent => ({
  type: SIDE_THREAD_SESSION_PANEL_TYPE,
  title: resolveChildSessionTitle(childSessionId, variant),
  data: {
    childSessionId,
    parentSessionId,
    workspacePath,
    variant,
  } satisfies ChildSessionPanelData,
  metadata: {
    duplicateCheckKey: getChildSessionDuplicateKey(childSessionId, variant),
    childSessionId,
    parentSessionId,
    contentRole: 'btw-session',
    variant,
  } satisfies ChildSessionPanelMetadata,
});

export const buildSideThreadSessionPanelContent = (
  childSessionId: string,
  parentSessionId: string,
  workspacePath?: string
): PanelContent =>
  buildChildSessionPanelContent(childSessionId, parentSessionId, workspacePath, 'btw');

export const selectActiveAgentTab = (state: AgentCanvasState) => {
  const activeGroup = state.activeGroupId === 'primary'
    ? state.primaryGroup
    : state.activeGroupId === 'secondary'
      ? state.secondaryGroup
      : state.tertiaryGroup;
  const activeTabId = activeGroup.activeTabId;
  if (!activeTabId) return null;
  return activeGroup.tabs.find(tab => tab.id === activeTabId && !tab.isHidden) ?? null;
};

export const selectActiveSideThreadSessionTab = (state: AgentCanvasState): CanvasTab | null => {
  const activeTab = selectActiveAgentTab(state);
  if (!activeTab || !isSideThreadSessionPanelContent(activeTab.content)) {
    return null;
  }

  const data = activeTab.content.data as ChildSessionPanelData | undefined;
  if (!data?.childSessionId || !data.parentSessionId) {
    return null;
  }

  return activeTab;
};

export const selectActiveChildSessionTab = (state: AgentCanvasState): CanvasTab | null => {
  const activeTab = selectActiveAgentTab(state);
  if (!activeTab || !isChildSessionPanelContent(activeTab.content)) {
    return null;
  }

  const data = activeTab.content.data as ChildSessionPanelData | undefined;
  if (!data?.childSessionId || !data.parentSessionId) {
    return null;
  }

  return activeTab;
};

export async function openMainSession(
  sessionId: string,
  options?: {
    workspaceId?: string;
    activateWorkspace?: (workspaceId: string) => void | Promise<unknown>;
  }
): Promise<void> {
  appManager.updateLayout({
    leftPanelActiveTab: 'sessions',
  });

  if (options?.workspaceId && options.activateWorkspace) {
    await options.activateWorkspace(options.workspaceId);
  }

  if (flowChatStore.getState().activeSessionId === sessionId) {
    syncSessionToModernStore(sessionId);
  } else {
    await flowChatManager.switchChatSession(sessionId);
    syncSessionToModernStore(sessionId);
  }

  const session = flowChatStore.getState().sessions.get(sessionId);
  useWorkspaceSurfaceStore.getState().openSurface(
    session && isSystemAgenticOsSession(session.descriptor)
      ? { kind: 'dispatcher-home', dispatcherSessionId: sessionId }
      : { kind: 'session', sessionId }
  );
}

export function openBtwSessionInAuxPane(params: {
  childSessionId: string;
  parentSessionId: string;
  workspacePath?: string;
  expand?: boolean;
}): void {
  openChildSessionInAuxPane({
    ...params,
    variant: 'btw',
  });
}

export function openChildSessionInAuxPane(params: {
  childSessionId: string;
  parentSessionId: string;
  workspacePath?: string;
  expand?: boolean;
  variant?: ChildSessionPanelVariant;
}): void {
  const variant = params.variant || 'btw';
  const content = buildChildSessionPanelContent(
    params.childSessionId,
    params.parentSessionId,
    params.workspacePath,
    variant
  );

  if (params.expand !== false) {
    window.dispatchEvent(new CustomEvent('expand-right-panel'));
  }

  createTab({
    type: content.type,
    title: content.title,
    data: content.data,
    metadata: content.metadata,
    checkDuplicate: true,
    duplicateCheckKey: content.metadata?.duplicateCheckKey,
    replaceExisting: false,
    mode: 'agent',
  });
}

export function isSideThreadSessionPanelContent(
  content: PanelContent | null | undefined
): boolean {
  return content?.type === SIDE_THREAD_SESSION_PANEL_TYPE;
}
