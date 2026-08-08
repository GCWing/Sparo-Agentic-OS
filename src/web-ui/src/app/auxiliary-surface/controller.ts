import {
  getActiveAgentCanvasHostKey,
  useAgentCanvasStore,
} from '@/app/components/panels/content-canvas/stores';
import { openCanvasItemInStore } from '@/app/components/panels/content-canvas/openCanvasItem';
import {
  AUXILIARY_SURFACE_CONFIG,
  getModeWidth,
  type PanelDisplayMode,
} from '@/app/layout/panelConfig';
import { createLogger } from '@/shared/utils/logger';
import { useAuxiliarySurfaceStore } from './auxiliarySurfaceStore';
import type {
  AuxiliaryItemDescriptor,
  AuxiliarySurfaceHostKey,
  AuxiliarySurfacePresentation,
  OpenAuxiliaryItemCommand,
} from './types';

const log = createLogger('AuxiliarySurface');
const pendingCommands = new Map<AuxiliarySurfaceHostKey, OpenAuxiliaryItemCommand[]>();
const restorers = new Map<AuxiliarySurfaceHostKey, () => void>();

function hasVisibleCanvasItems(): boolean {
  return useAgentCanvasStore.getState().getAllTabs().some(tab => tab.isHidden !== true);
}

function duplicateKey(item: AuxiliaryItemDescriptor): string | undefined {
  return item.duplicateCheckKey
    ?? (typeof item.metadata?.duplicateCheckKey === 'string'
      ? item.metadata.duplicateCheckKey
      : undefined);
}

function openInLiveCanvas(command: OpenAuxiliaryItemCommand): void {
  const { hostKey, item } = command;
  const store = useAgentCanvasStore.getState();
  openCanvasItemInStore(store, item, { auxiliaryHostKey: hostKey });
}

function reveal(command: OpenAuxiliaryItemCommand): void {
  const revealMode = command.reveal ?? 'explicit';
  if (revealMode === 'explicit') {
    useAuxiliarySurfaceStore.getState().reveal(command.hostKey, 'explicit');
  }
}

function enqueue(command: OpenAuxiliaryItemCommand): void {
  const queue = pendingCommands.get(command.hostKey) ?? [];
  const key = duplicateKey(command.item);
  if (key) {
    const index = queue.findIndex(item => duplicateKey(item.item) === key);
    if (index >= 0) {
      queue[index] = command;
      pendingCommands.set(command.hostKey, queue);
      return;
    }
  }
  pendingCommands.set(command.hostKey, [...queue, command]);
}

export function openAuxiliaryItem(command: OpenAuxiliaryItemCommand): void {
  if (getActiveAgentCanvasHostKey() !== command.hostKey) {
    enqueue(command);
    log.debug('Queued auxiliary item for inactive host', {
      hostKey: command.hostKey,
      type: command.item.type,
    });
    return;
  }

  openInLiveCanvas(command);
  reveal(command);
}

export function openActiveAuxiliaryItem(
  item: AuxiliaryItemDescriptor,
  revealMode: OpenAuxiliaryItemCommand['reveal'] = 'explicit',
): boolean {
  const hostKey = useAuxiliarySurfaceStore.getState().activeHostKey;
  if (!hostKey) return false;
  openAuxiliaryItem({ hostKey, item, reveal: revealMode });
  return true;
}

export function openActiveAuxiliaryItemAtPresentation(
  item: AuxiliaryItemDescriptor,
  presentation: Exclude<AuxiliarySurfacePresentation, 'closed'>,
): boolean {
  const surfaceStore = useAuxiliarySurfaceStore.getState();
  const hostKey = surfaceStore.activeHostKey;
  if (!hostKey || getActiveAgentCanvasHostKey() !== hostKey) return false;

  // Scene focus is a presentation transition of the active session container.
  // This command never navigates to PanelViewScene or creates another canvas.
  openAuxiliaryItem({
    hostKey,
    item,
    reveal: presentation === 'docked' ? 'explicit' : 'preserve',
  });
  if (presentation === 'scene-focus') {
    surfaceStore.enterSceneFocus(hostKey);
  }
  return true;
}

export function flushAuxiliaryItems(hostKey: AuxiliarySurfaceHostKey): void {
  const queue = pendingCommands.get(hostKey);
  if (!queue?.length || getActiveAgentCanvasHostKey() !== hostKey) return;
  pendingCommands.delete(hostKey);
  queue.forEach(command => {
    openInLiveCanvas(command);
    reveal(command);
  });
}

export function forgetAuxiliaryCommands(hostKeys: readonly AuxiliarySurfaceHostKey[]): void {
  hostKeys.forEach(hostKey => {
    pendingCommands.delete(hostKey);
    restorers.delete(hostKey);
  });
}

export function registerAuxiliarySurfaceRestorer(
  hostKey: AuxiliarySurfaceHostKey,
  restore: () => void,
): () => void {
  restorers.set(hostKey, restore);
  return () => {
    if (restorers.get(hostKey) === restore) {
      restorers.delete(hostKey);
    }
  };
}

export function toggleActiveAuxiliarySurface(): boolean {
  const store = useAuxiliarySurfaceStore.getState();
  const hostKey = store.activeHostKey;
  if (!hostKey) return false;
  if (getActiveAgentCanvasHostKey() !== hostKey) return false;
  const presentation = store.hosts[hostKey]?.presentation ?? 'closed';
  if (presentation === 'scene-focus') {
    store.exitSceneFocus(hostKey, 'previous');
    return true;
  }
  if (presentation === 'closed') {
    if (!hasVisibleCanvasItems()) {
      const restoreProfileItems = restorers.get(hostKey);
      if (restoreProfileItems) {
        restoreProfileItems();
      } else {
        useAgentCanvasStore.getState().reopenClosedTab();
      }
    }
    store.reveal(hostKey, 'user');
  } else {
    store.collapse(hostKey, 'user');
  }
  return true;
}

export function enterActiveAuxiliarySceneFocus(): boolean {
  const store = useAuxiliarySurfaceStore.getState();
  const hostKey = store.activeHostKey;
  if (!hostKey || getActiveAgentCanvasHostKey() !== hostKey || !hasVisibleCanvasItems()) return false;
  store.enterSceneFocus(hostKey);
  return true;
}

export function exitActiveAuxiliarySceneFocus(
  restore: 'previous' | 'docked' = 'previous',
): boolean {
  const store = useAuxiliarySurfaceStore.getState();
  const hostKey = store.activeHostKey;
  if (!hostKey || store.hosts[hostKey]?.presentation !== 'scene-focus') return false;
  store.exitSceneFocus(hostKey, restore);
  return true;
}

export function collapseActiveAuxiliarySurface(): boolean {
  const store = useAuxiliarySurfaceStore.getState();
  if (!store.activeHostKey) return false;
  store.collapse(store.activeHostKey, 'user');
  return true;
}

export function resizeActiveAuxiliarySurface(
  mode: Exclude<PanelDisplayMode, 'collapsed'>,
): boolean {
  const store = useAuxiliarySurfaceStore.getState();
  if (!store.activeHostKey) return false;
  store.setWidth(getModeWidth(mode, AUXILIARY_SURFACE_CONFIG));
  return true;
}
