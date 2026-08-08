import type { PanelContent } from './types';
import type { CanvasItemDescriptor } from './types';
import {
  useProjectCanvasStore,
  type CanvasStore,
} from './stores/canvasStore';

export function openCanvasItemInStore(
  store: CanvasStore,
  item: CanvasItemDescriptor,
  ownershipMetadata?: Record<string, unknown>,
): void {
  const duplicateCheckKey =
    item.duplicateCheckKey
    ?? (typeof item.metadata?.duplicateCheckKey === 'string'
      ? item.metadata.duplicateCheckKey
      : undefined);
  const content: PanelContent = {
    type: item.type,
    title: item.title,
    data: item.data,
    metadata: {
      ...item.metadata,
      ...(duplicateCheckKey ? { duplicateCheckKey } : {}),
      ...ownershipMetadata,
    },
  };

  if (item.enableSplitView && store.layout.splitMode === 'none') {
    store.setSplitMode('vertical');
  }

  if (duplicateCheckKey) {
    const existing = store.findTabByMetadata({ duplicateCheckKey });
    if (existing) {
      const data = item.data as Record<string, unknown> | undefined;
      const hasJumpTarget = Boolean(
        data?.jumpToRange || data?.jumpToLine || data?.jumpToColumn,
      );
      if (item.replaceExisting !== false || hasJumpTarget) {
        store.updateTabContent(existing.tab.id, existing.groupId, content);
      }
      store.switchToTab(existing.tab.id, existing.groupId);
      if (existing.tab.state === 'preview') {
        store.promoteTab(existing.tab.id, existing.groupId);
      }
      return;
    }
  }

  const groupId =
    item.enableSplitView && item.targetGroup
      ? item.targetGroup
      : item.targetGroup ?? store.activeGroupId;
  store.addTab(content, 'active', groupId);
}

export function openProjectCanvasItem(item: CanvasItemDescriptor): void {
  openCanvasItemInStore(useProjectCanvasStore.getState(), item);
}
