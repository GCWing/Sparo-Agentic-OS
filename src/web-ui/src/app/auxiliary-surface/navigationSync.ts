import {
  activateAgentCanvasHost,
  removeAgentCanvasHost,
} from '@/app/components/panels/content-canvas/stores';
import type { WorkspaceSurface } from '@/app/navigation/workspaceSurfaceTypes';
import { useAuxiliarySurfaceStore } from './auxiliarySurfaceStore';
import { flushAuxiliaryItems, forgetAuxiliaryCommands } from './controller';
import { auxiliaryHostKeysForSession, resolveAuxiliaryHostKey } from './host';

export function synchronizeAuxiliarySurface(
  surface: WorkspaceSurface,
  currentOsSessionId: string | null,
): void {
  const hostKey = resolveAuxiliaryHostKey(surface, currentOsSessionId);
  activateAgentCanvasHost(hostKey);
  useAuxiliarySurfaceStore.getState().activateHost(hostKey);
  if (hostKey) flushAuxiliaryItems(hostKey);
}

export function forgetSessionAuxiliarySurfaces(sessionIds: readonly string[]): void {
  const hostKeys = sessionIds.flatMap(auxiliaryHostKeysForSession);
  hostKeys.forEach(removeAgentCanvasHost);
  forgetAuxiliaryCommands(hostKeys);
  useAuxiliarySurfaceStore.getState().forgetHosts(hostKeys);
}
