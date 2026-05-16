/**
 * navSceneStore — left-panel navigation mode (2-state toggle).
 *
 * Two visual states:
 *   - showSceneNav = false → no scene-specific sidebar nav
 *   - showSceneNav = true  → scene-specific nav identified by navSceneId
 *
 * navSceneId can be set from two sources:
 *   1. Workspace surface navigation sync
 *   2. Left-side nav item click (e.g. "Project" → file-viewer nav)
 *
 * goBack keeps navSceneId so goForward can restore it.
 * closeNavScene clears both (used when a surface switches to a scene without nav).
 */

import { create } from 'zustand';
import type { WorkspaceSceneId } from '../navigation/workspaceSceneTypes';

interface NavSceneState {
  showSceneNav: boolean;
  navSceneId: WorkspaceSceneId | null;
  openNavScene: (id: WorkspaceSceneId) => void;
  closeNavScene: () => void;
  goBack: () => void;
  goForward: () => void;
}

export const useNavSceneStore = create<NavSceneState>((set) => ({
  showSceneNav: false,
  navSceneId: null,
  openNavScene: (id) => set({ showSceneNav: true, navSceneId: id }),
  closeNavScene: () => set({ showSceneNav: false, navSceneId: null }),
  goBack: () => set({ showSceneNav: false }),
  goForward: () => set({ showSceneNav: true }),
}));

export function selectNavCanGoBack(state: NavSceneState): boolean {
  return state.showSceneNav;
}
