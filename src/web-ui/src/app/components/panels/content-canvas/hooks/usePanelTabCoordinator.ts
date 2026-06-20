/**
 * usePanelTabCoordinator Hook
 * Tab and panel state coordinator.
 *
 * Responsibilities:
 * 1. Watch tab count changes and manage panel expand/collapse
 * 2. Auto-open the profile-designated tab when the active session changes
 * 3. Close exclusive tab types that belong to a previous profile
 * 4. Ensure state consistency and avoid race conditions
 */

import { useEffect, useRef, useCallback } from 'react';
import { useCanvasStore } from '../stores';
import { useAgentCanvasStore } from '../stores';
import { useApp } from '@/app/hooks/useApp';
import { useSessionProfile } from '@/app/session-profiles';
import { useActiveSession } from '@/flow_chat/store/modernFlowChatStore';
import { useLiveAppStore } from '@/app/scenes/apps/live-app/liveAppStore';
import { TAB_EVENTS } from '../types';
import { loadPanelWidth, STORAGE_KEYS, RIGHT_PANEL_CONFIG } from '@/app/layout/panelConfig';
import type { EditorGroupId } from '../types';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('usePanelTabCoordinator');

interface UsePanelTabCoordinatorOptions {
  /** Auto-collapse when all tabs are closed */
  autoCollapseOnEmpty?: boolean;
  /** Auto-expand when a tab opens */
  autoExpandOnTabOpen?: boolean;
}

/**
 * Tab and panel state coordinator.
 *
 * Design principles:
 * 1. Single source of truth: tabs from canvasStore, panels from useApp
 * 2. Profile-driven: auto-open/close logic comes from SessionProfile.auxTabs
 * 3. Reactive sync: update panel state on tab changes
 * 4. Event-driven: coordinate through unified events
 */
export const usePanelTabCoordinator = (options: UsePanelTabCoordinatorOptions = {}) => {
  const {
    autoCollapseOnEmpty = true,
    autoExpandOnTabOpen = true,
  } = options;

  const {
    primaryGroup,
    secondaryGroup,
    addTab,
    findTabByMetadata,
    promoteTab,
    switchToTab,
    updateTabContent,
  } = useCanvasStore();

  const { state, toggleRightPanel, updateRightPanelWidth } = useApp();
  const { profile } = useSessionProfile();
  const activeSession = useActiveSession();

  // Use refs to avoid stale closures and add guards
  const rightPanelCollapsedRef = useRef(
    state?.layout?.rightPanelCollapsed ?? true
  );
  const toggleRightPanelRef = useRef(toggleRightPanel);
  const isInitializedRef = useRef(false);

  // Track which session we've already auto-opened a tab for (avoid duplicate opens)
  const autoOpenedSessionIdsRef = useRef<Set<string>>(new Set());
  // Track which profile's exclusive tabs we've already cleaned (avoid thrash)
  const lastCleanedProfileIdRef = useRef<string | null>(null);

  // Sync refs
  useEffect(() => {
    if (state?.layout) {
      rightPanelCollapsedRef.current = state.layout.rightPanelCollapsed ?? true;
    }
    toggleRightPanelRef.current = toggleRightPanel;
    if (!isInitializedRef.current) {
      isInitializedRef.current = true;
    }
  }, [state?.layout, toggleRightPanel]);

  // Read studioAppId for LiveAppStudio profile
  const studioAppId = useLiveAppStore((s) =>
    activeSession?.sessionId ? s.sessionAppIds[activeSession.sessionId] : undefined
  );

  /**
   * Expand right panel (set width first, then expand to avoid flicker).
   */
  const expandPanel = useCallback(() => {
    if (rightPanelCollapsedRef.current && toggleRightPanelRef.current && updateRightPanelWidth) {
      const persisted = loadPanelWidth(
        STORAGE_KEYS.RIGHT_PANEL_LAST_WIDTH,
        RIGHT_PANEL_CONFIG.COMFORTABLE_DEFAULT
      );
      const current = state.layout.rightPanelWidth;
      const widthToUse =
        current >= RIGHT_PANEL_CONFIG.COMPACT_WIDTH ? current : persisted;
      updateRightPanelWidth(widthToUse);

      window.dispatchEvent(new CustomEvent('expand-right-panel-immediate', {
        detail: { noAnimation: true }
      }));

      requestAnimationFrame(() => {
        if (toggleRightPanelRef.current) {
          toggleRightPanelRef.current();
        }
      });
    }
  }, [updateRightPanelWidth, state.layout.rightPanelWidth]);

  /**
   * Collapse right panel.
   */
  const collapsePanel = useCallback(() => {
    if (!rightPanelCollapsedRef.current && toggleRightPanelRef.current) {
      requestAnimationFrame(() => {
        if (toggleRightPanelRef.current) {
          toggleRightPanelRef.current();
        }
      });
    }
  }, []);

  /**
   * Close all tabs matching the given exclusive tab types from the agent canvas store.
   * Runs up to maxPasses iterations to handle stores that update asynchronously.
   */
  const closeExclusiveTabTypes = useCallback((tabTypes: readonly string[]) => {
    if (tabTypes.length === 0) return;
    const maxPasses = 32;
    const groupIds: EditorGroupId[] = ['primary', 'secondary', 'tertiary'];
    for (let pass = 0; pass < maxPasses; pass++) {
      const store = useAgentCanvasStore.getState() as any;
      let closedOne = false;
      for (const groupId of groupIds) {
        const group =
          groupId === 'primary'
            ? store.primaryGroup
            : groupId === 'secondary'
              ? store.secondaryGroup
              : store.tertiaryGroup;
        const tab = group?.tabs?.find((t: any) => tabTypes.includes(t.content.type));
        if (tab) {
          store.closeTab(tab.id, groupId, { forceRemove: true });
          closedOne = true;
          break;
        }
      }
      if (!closedOne) return;
    }
  }, []);

  /**
   * Profile-driven auto-open: when active session changes, open the profile's
   * designated tab if autoOpen is defined and we haven't done so for this session.
   */
  useEffect(() => {
    if (!isInitializedRef.current) return;
    if (!activeSession?.sessionId) return;
    if (!profile.auxTabs.autoOpen) return;

    if (autoOpenedSessionIdsRef.current.has(activeSession.sessionId)) return;
    autoOpenedSessionIdsRef.current.add(activeSession.sessionId);

    // Map profile id -> tab title. Keeps the profile free of i18n imports.
    const tabTitle =
      profile.id === 'agent-app-studio' ? 'Agent App Builder' : 'Live App Builder';
    const extra: Record<string, unknown> = {
      appId: studioAppId,
      tabTitle,
      liveAppWorkbench: activeSession.customMetadata?.liveAppWorkbench,
      customMetadata: activeSession.customMetadata,
    };

    const autoOpenResult = profile.auxTabs.autoOpen(activeSession.sessionId, extra);
    if (!autoOpenResult) return;
    const descriptors = Array.isArray(autoOpenResult) ? autoOpenResult : [autoOpenResult];
    if (descriptors.length === 0) return;

    log.debug('Auto-opening profile tab', {
      profileId: profile.id,
      sessionId: activeSession.sessionId,
      tabTypes: descriptors.map(descriptor => descriptor.type),
    });

    descriptors.forEach((descriptor) => {
      const content = {
        type: descriptor.type,
        title: descriptor.title,
        data: descriptor.data,
        metadata: {
          ...descriptor.metadata,
          duplicateCheckKey: descriptor.duplicateCheckKey,
        },
      };

      if (descriptor.duplicateCheckKey) {
        const existing = findTabByMetadata({ duplicateCheckKey: descriptor.duplicateCheckKey });
        if (existing) {
          if (descriptor.replaceExisting) {
            updateTabContent(existing.tab.id, existing.groupId, content);
          }
          switchToTab(existing.tab.id, existing.groupId);
          if (existing.tab.state === 'preview') {
            promoteTab(existing.tab.id, existing.groupId);
          }
          return;
        }
      }

      addTab(content, 'active');
    });
    expandPanel();
  }, [
    activeSession?.customMetadata,
    activeSession?.sessionId,
    addTab,
    expandPanel,
    findTabByMetadata,
    profile,
    promoteTab,
    studioAppId,
    switchToTab,
    updateTabContent,
  ]);

  /**
   * Profile-driven exclusive tab cleanup: when the profile changes (user switches
   * session type), close tabs that belong exclusively to the previous profile.
   */
  useEffect(() => {
    if (!isInitializedRef.current) return;
    const exclusiveTypes = profile.auxTabs.exclusiveTabTypes;
    if (!exclusiveTypes || exclusiveTypes.length === 0) return;

    // Only clean up when we've navigated AWAY from this profile's exclusive tabs
    // (i.e., the current profile does NOT own these types).
    // We track by profile.id to avoid re-running on every render.
    if (lastCleanedProfileIdRef.current === profile.id) return;

    // Don't close — these belong to the CURRENT profile.
    // The cleanup runs for the PREVIOUS profile's exclusive types.
    // We detect "away" by the fact that a new profile.id differs from what we
    // stored. The actual close happens on the next profile change.
    lastCleanedProfileIdRef.current = profile.id;
  }, [profile.id, profile.auxTabs.exclusiveTabTypes]);

  useEffect(() => {
    if (!isInitializedRef.current) return;
    if (!activeSession?.sessionId) return;

    const workbenchTabTypes = [
      'live-app-runner',
      'live-app-workbench-tab',
      'live-app-diagnostics',
    ];
    const currentOwnedTypes = profile.auxTabs.exclusiveTabTypes || [];
    const maxPasses = 48;
    const groupIds: EditorGroupId[] = ['primary', 'secondary', 'tertiary'];
    for (let pass = 0; pass < maxPasses; pass++) {
      const store = useAgentCanvasStore.getState() as any;
      let closedOne = false;
      for (const groupId of groupIds) {
        const group =
          groupId === 'primary'
            ? store.primaryGroup
            : groupId === 'secondary'
              ? store.secondaryGroup
              : store.tertiaryGroup;
        const tab = group?.tabs?.find((t: any) => {
          if (!workbenchTabTypes.includes(t.content.type)) return false;
          const bound = t.content.metadata?.boundSessionId;
          const ownedByCurrentProfile = currentOwnedTypes.includes(t.content.type);
          return !ownedByCurrentProfile || (typeof bound === 'string' && bound !== activeSession.sessionId);
        });
        if (tab) {
          store.closeTab(tab.id, groupId, { forceRemove: true });
          closedOne = true;
          break;
        }
      }
      if (!closedOne) break;
    }
  }, [activeSession?.sessionId, profile]);

  /**
   * Non-LiveAppStudio sessions: close any live-app-studio tabs that don't belong
   * to the active session. This is the generalised replacement for the old
   * closeForeignLiveAppStudioTabs call.
   */
  useEffect(() => {
    if (!isInitializedRef.current) return;
    if (!activeSession?.sessionId) return;

    // If the current profile owns live-app-studio tabs, don't clean them up.
    if (profile.auxTabs.exclusiveTabTypes?.includes('live-app-studio')) return;

    // Otherwise, close any stray live-app-studio tabs from other sessions.
    const maxPasses = 48;
    const groupIds: EditorGroupId[] = ['primary', 'secondary', 'tertiary'];
    for (let pass = 0; pass < maxPasses; pass++) {
      const store = useAgentCanvasStore.getState() as any;
      let closedOne = false;
      for (const groupId of groupIds) {
        const group =
          groupId === 'primary'
            ? store.primaryGroup
            : groupId === 'secondary'
              ? store.secondaryGroup
              : store.tertiaryGroup;
        const tab = group?.tabs?.find((t: any) => {
          if (t.content.type !== 'live-app-studio') return false;
          const bound = t.content.metadata?.liveAppStudioSessionId;
          return typeof bound === 'string' && bound !== activeSession.sessionId;
        });
        if (tab) {
          store.closeTab(tab.id, groupId, { forceRemove: true });
          closedOne = true;
          break;
        }
      }
      if (!closedOne) break;
    }
  }, [activeSession?.sessionId, profile]);

  /**
   * Non-AgentAppStudio sessions: close any agent-app-studio tabs that don't belong
   * to the active session. Mirrors the live-app-studio cleanup above.
   */
  useEffect(() => {
    if (!isInitializedRef.current) return;
    if (!activeSession?.sessionId) return;

    if (profile.auxTabs.exclusiveTabTypes?.includes('agent-app-studio')) return;

    const maxPasses = 48;
    const groupIds: EditorGroupId[] = ['primary', 'secondary', 'tertiary'];
    for (let pass = 0; pass < maxPasses; pass++) {
      const store = useAgentCanvasStore.getState() as any;
      let closedOne = false;
      for (const groupId of groupIds) {
        const group =
          groupId === 'primary'
            ? store.primaryGroup
            : groupId === 'secondary'
              ? store.secondaryGroup
              : store.tertiaryGroup;
        const tab = group?.tabs?.find((t: any) => {
          if (t.content.type !== 'agent-app-studio') return false;
          const bound = t.content.metadata?.agentAppStudioSessionId;
          return typeof bound === 'string' && bound !== activeSession.sessionId;
        });
        if (tab) {
          store.closeTab(tab.id, groupId, { forceRemove: true });
          closedOne = true;
          break;
        }
      }
      if (!closedOne) break;
    }
  }, [activeSession?.sessionId, profile]);

  /**
   * Watch tab count changes and manage panel expand/collapse.
   */
  useEffect(() => {
    if (!isInitializedRef.current) return;

    const primaryVisible = primaryGroup.tabs.filter(t => !t.isHidden).length;
    const secondaryVisible = secondaryGroup.tabs.filter(t => !t.isHidden).length;
    const visibleCount = primaryVisible + secondaryVisible;

    const isCollapsed = rightPanelCollapsedRef.current;

    if (visibleCount === 0 && autoCollapseOnEmpty && !isCollapsed) {
      collapsePanel();
    } else if (visibleCount > 0 && autoExpandOnTabOpen && isCollapsed) {
      expandPanel();
    }
  }, [
    primaryGroup.tabs,
    secondaryGroup.tabs,
    autoCollapseOnEmpty,
    autoExpandOnTabOpen,
    expandPanel,
    collapsePanel,
  ]);

  /**
   * Listen for expand-right-panel events.
   */
  useEffect(() => {
    const handleExpandRightPanel = () => {
      if (autoExpandOnTabOpen) {
        expandPanel();
      }
    };

    window.addEventListener(TAB_EVENTS.EXPAND_RIGHT_PANEL, handleExpandRightPanel);

    return () => {
      window.removeEventListener(TAB_EVENTS.EXPAND_RIGHT_PANEL, handleExpandRightPanel);
    };
  }, [autoExpandOnTabOpen, expandPanel]);

  return {
    expandPanel,
    collapsePanel,
    closeExclusiveTabTypes,
  };
};

export default usePanelTabCoordinator;
