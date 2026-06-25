import { TAB_EVENTS, type CreateTabEventDetail } from '@/app/components/panels/content-canvas/types';
import { useAgentCanvasStore } from '@/app/components/panels/content-canvas/stores';
import type { PanelContent } from '@/app/components/panels/content-canvas/types';
import { createLogger } from '@/shared/utils/logger';
import type { TabAutoOpenDescriptor } from './types';

const log = createLogger('SessionSidecarActions');

function expandRightPanel(): void {
  window.dispatchEvent(new CustomEvent(TAB_EVENTS.EXPAND_RIGHT_PANEL));
}

function openAgentCanvasTab(detail: CreateTabEventDetail): void {
  const {
    type,
    title,
    data,
    metadata,
    checkDuplicate,
    duplicateCheckKey,
    replaceExisting,
    targetGroup,
    enableSplitView,
  } = detail;

  const store = useAgentCanvasStore.getState();
  const content: PanelContent = {
    type,
    title,
    data,
    metadata: duplicateCheckKey
      ? { ...metadata, duplicateCheckKey }
      : metadata,
  };

  if (enableSplitView && store.layout.splitMode === 'none') {
    store.setSplitMode('vertical');
  }

  if (checkDuplicate && duplicateCheckKey) {
    const existing = store.findTabByMetadata({ duplicateCheckKey });
    if (existing) {
      const hasJumpInfo = data?.jumpToRange || data?.jumpToLine || data?.jumpToColumn;
      if (replaceExisting || hasJumpInfo) {
        store.updateTabContent(existing.tab.id, existing.groupId, content);
      }
      store.switchToTab(existing.tab.id, existing.groupId);
      if (existing.tab.state === 'preview') {
        store.promoteTab(existing.tab.id, existing.groupId);
      }
      expandRightPanel();
      return;
    }
  }

  const groupId = (enableSplitView && targetGroup)
    ? targetGroup
    : targetGroup || store.activeGroupId;
  store.addTab(content, 'active', groupId);
  expandRightPanel();
}

export function openSessionSidecarPanel(panel: TabAutoOpenDescriptor): void {
  const duplicateCheckKey =
    panel.duplicateCheckKey ??
    (typeof panel.metadata?.duplicateCheckKey === 'string'
      ? panel.metadata.duplicateCheckKey
      : undefined);

  const detail: CreateTabEventDetail = {
    type: panel.type,
    title: panel.title,
    data: panel.data,
    metadata: duplicateCheckKey
      ? { ...panel.metadata, duplicateCheckKey }
      : panel.metadata,
    checkDuplicate: Boolean(duplicateCheckKey),
    duplicateCheckKey,
    replaceExisting: panel.replaceExisting ?? true,
    targetGroup: panel.targetGroup,
    enableSplitView: panel.enableSplitView,
  };

  log.debug('Opening session sidecar panel', {
    type: panel.type,
    duplicateCheckKey,
    title: panel.title,
  });

  openAgentCanvasTab(detail);
}
