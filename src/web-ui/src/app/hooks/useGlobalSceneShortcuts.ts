/**
 * Global shortcuts for scene / overlay actions (catalog-driven keys — ⌘ on macOS, Ctrl on Win/Linux).
 *
 *   Mod+,       — Settings overlay
 *   Mod+Shift+` — Terminal overlay
 */

import { useCallback } from 'react';
import { useShortcut } from '@/infrastructure/hooks/useShortcut';
import { ALL_SHORTCUTS } from '@/shared/constants/shortcuts';
import { openWorkspaceScene } from '@/app/navigation/workspaceNavigation';
import type { WorkspaceSceneId } from '@/app/navigation/workspaceSceneTypes';

const shortcut = (id: string) => ALL_SHORTCUTS.find((d) => d.id === id)!;

function openSceneById(id: WorkspaceSceneId): void {
  openWorkspaceScene(id);
}

export function useGlobalSceneShortcuts(): void {
  const openSettings = useCallback(() => openSceneById('settings'), []);
  const openTerminal = useCallback(() => openSceneById('terminal'), []);

  const dOpenSettings = shortcut('scene.openSettings');
  useShortcut(dOpenSettings.id, dOpenSettings.config, openSettings, {
    priority: 10,
    description: dOpenSettings.descriptionKey,
  });

  const dOpenTerminal = shortcut('scene.openTerminal');
  useShortcut(dOpenTerminal.id, dOpenTerminal.config, openTerminal, {
    priority: 10,
    description: dOpenTerminal.descriptionKey,
  });
}
