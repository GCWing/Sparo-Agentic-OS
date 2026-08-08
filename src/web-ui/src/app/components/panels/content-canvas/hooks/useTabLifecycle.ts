/**
 * useTabLifecycle Hook
 * Manages tab lifecycle state transitions.
 *
 * State flow:
 * - Single click -> preview (replaces current preview tab)
 * - Double click / edit -> active
 * - Pin action -> pinned
 */

import { useCallback, useEffect } from 'react';
import { useCanvasStore, useAgentCanvasStore, useProjectCanvasStore } from '../stores';
import type { EditorGroupId, PanelContent } from '../types';
import { useI18n } from '@/infrastructure/i18n';
import { confirmDialog } from '@/design-system';
interface UseTabLifecycleOptions {
  /** App mode / target canvas */
  mode?: 'agent' | 'project';
  /** Called after a close operation removes the final visible tab. */
  onLastVisibleTabClosed?: () => void;
}

interface UseTabLifecycleReturn {
  /** Open on single click (preview mode) */
  openPreview: (content: PanelContent, groupId?: EditorGroupId) => void;

  /** Open on double click (active mode) */
  openActive: (content: PanelContent, groupId?: EditorGroupId) => void;

  /** Promote to active on content edit */
  onContentEdit: (tabId: string, groupId: EditorGroupId) => void;

  /** Toggle pin/unpin */
  togglePin: (tabId: string, groupId: EditorGroupId) => void;

  /** Dirty check before closing a tab */
  handleCloseWithDirtyCheck: (tabId: string, groupId: EditorGroupId) => Promise<boolean>;

  /** Dirty check before closing all tabs */
  handleCloseAllWithDirtyCheck: (groupId: EditorGroupId) => Promise<boolean>;
}

/**
 * Tab lifecycle management hook.
 */
export const useTabLifecycle = (options: UseTabLifecycleOptions = {}): UseTabLifecycleReturn => {
  const { mode = 'agent', onLastVisibleTabClosed } = options;
  const { t } = useI18n('components');
  const canvasStoreApi =
    mode === 'project' ? useProjectCanvasStore : useAgentCanvasStore;
  
  const {
    addTab,
    promoteTab,
    togglePinTab,
    findTabByMetadata,
    switchToTab,
    closeTab,
    closeAllTabs,
    activeGroupId,
  } = useCanvasStore();

  /**
   * Open in preview mode (replaces current preview tab).
   */
  const openPreview = useCallback((content: PanelContent, groupId?: EditorGroupId) => {
    const targetGroupId = groupId || activeGroupId;
    
    // Check for existing tab with same content
    if (content.metadata?.duplicateCheckKey) {
      const existing = findTabByMetadata({ duplicateCheckKey: content.metadata.duplicateCheckKey });
      if (existing) {
        // Switch to existing tab
        switchToTab(existing.tab.id, existing.groupId);
        return;
      }
    }
    
    // Add preview tab (auto-replaces current preview tab)
    addTab(content, 'preview', targetGroupId);
  }, [activeGroupId, findTabByMetadata, switchToTab, addTab]);

  /**
   * Open directly in active state.
   */
  const openActive = useCallback((content: PanelContent, groupId?: EditorGroupId) => {
    const targetGroupId = groupId || activeGroupId;
    
    // Check for existing tab with same content
    if (content.metadata?.duplicateCheckKey) {
      const existing = findTabByMetadata({ duplicateCheckKey: content.metadata.duplicateCheckKey });
      if (existing) {
        // Switch to existing tab and ensure active state
        switchToTab(existing.tab.id, existing.groupId);
        if (existing.tab.state === 'preview') {
          promoteTab(existing.tab.id, existing.groupId);
        }
        return;
      }
    }
    
    // Add active tab
    addTab(content, 'active', targetGroupId);
  }, [activeGroupId, findTabByMetadata, switchToTab, promoteTab, addTab]);

  /**
   * Promote to active on edit.
   */
  const onContentEdit = useCallback((tabId: string, groupId: EditorGroupId) => {
    promoteTab(tabId, groupId);
  }, [promoteTab]);

  /**
   * Toggle pin/unpin.
   */
  const togglePin = useCallback((tabId: string, groupId: EditorGroupId) => {
    togglePinTab(tabId, groupId);
  }, [togglePinTab]);

  const getGroup = useCallback((groupId: EditorGroupId) => {
    const state = canvasStoreApi.getState();
    if (groupId === 'primary') return state.primaryGroup;
    if (groupId === 'secondary') return state.secondaryGroup;
    return state.tertiaryGroup;
  }, [canvasStoreApi]);

  const notifyIfCanvasIsEmpty = useCallback(() => {
    const hasVisibleTabs = canvasStoreApi.getState().getAllTabs()
      .some(tab => tab.isHidden !== true);
    if (!hasVisibleTabs) {
      onLastVisibleTabClosed?.();
    }
  }, [canvasStoreApi, onLastVisibleTabClosed]);

  /**
   * Dirty check before closing a tab.
   */
  const handleCloseWithDirtyCheck = useCallback(async (tabId: string, groupId: EditorGroupId): Promise<boolean> => {
    const group = getGroup(groupId);
    const tab = group.tabs.find(t => t.id === tabId);

    if (!tab) {
      return true;
    }

    if (tab.isDirty) {
      const result = await confirmDialog({
        title: t('tabs.unsaved'),
        message: t('tabs.confirmCloseWithDirty', { title: tab.title }),
        type: 'warning',
        confirmDanger: true,
      });

      if (!result) {
        return false;
      }
    }

    closeTab(tabId, groupId);
    notifyIfCanvasIsEmpty();
    return true;
  }, [closeTab, getGroup, notifyIfCanvasIsEmpty, t]);

  /**
   * Dirty check before closing all tabs.
   */
  const handleCloseAllWithDirtyCheck = useCallback(async (groupId: EditorGroupId): Promise<boolean> => {
    const group = getGroup(groupId);
    const dirtyTabs = group.tabs.filter(t => t.isDirty);

    if (dirtyTabs.length === 0) {
      closeAllTabs(groupId);
      notifyIfCanvasIsEmpty();
      return true;
    }

    const fileList = dirtyTabs.map(t => `  - ${t.title}`).join('\n');
    const result = await confirmDialog({
      title: t('tabs.unsaved'),
      message: t('tabs.confirmCloseAllWithDirty', { count: dirtyTabs.length, fileList }),
      type: 'warning',
      confirmDanger: true,
      preview: fileList,
    });

    if (!result) {
      return false;
    }

    closeAllTabs(groupId);
    notifyIfCanvasIsEmpty();
    return true;
  }, [closeAllTabs, getGroup, notifyIfCanvasIsEmpty, t]);

  /**
   * Listen for left-panel terminal close events to sync right-panel tabs.
   */
  useEffect(() => {
    const store = mode === 'project' ? useProjectCanvasStore : useAgentCanvasStore;
    
    const handleTerminalSessionDestroyed = (event: CustomEvent<{ sessionId: string }>) => {
      const { sessionId } = event.detail ?? {};
      if (sessionId) {
        store.getState().closeTerminalTabBySessionId(sessionId);
      }
    };
    window.addEventListener('terminal-session-destroyed', handleTerminalSessionDestroyed as EventListener);
    return () => {
      window.removeEventListener('terminal-session-destroyed', handleTerminalSessionDestroyed as EventListener);
    };
  }, [mode]);

  /**
   * Listen for left-panel terminal rename events to sync right-panel tabs.
   */
  useEffect(() => {
    const store = mode === 'project' ? useProjectCanvasStore : useAgentCanvasStore;
    
    const handleTerminalSessionRenamed = (event: CustomEvent<{ sessionId: string; newName: string }>) => {
      const { sessionId, newName } = event.detail ?? {};
      if (sessionId && newName) {
        store.getState().renameTerminalTabBySessionId(sessionId, newName);
      }
    };
    window.addEventListener('terminal-session-renamed', handleTerminalSessionRenamed as EventListener);
    return () => {
      window.removeEventListener('terminal-session-renamed', handleTerminalSessionRenamed as EventListener);
    };
  }, [mode]);

  return {
    openPreview,
    openActive,
    onContentEdit,
    togglePin,
    handleCloseWithDirtyCheck,
    handleCloseAllWithDirtyCheck,
  };
};

export default useTabLifecycle;
