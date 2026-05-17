import { create } from 'zustand';
import { getSceneNav } from '../scenes/nav-registry';
import { useNavSceneStore } from '../stores/navSceneStore';
import type { WorkspaceSceneId } from './workspaceSceneTypes';
import {
  isSameWorkspaceSurface,
  type WorkspaceSurface,
} from './workspaceSurfaceTypes';

interface WorkspaceSurfaceState {
  activeSurface: WorkspaceSurface;
  previousSurface: WorkspaceSurface | null;
  openSurface: (surface: WorkspaceSurface) => void;
  returnHome: (dispatcherSessionId?: string | null) => void;
}

function resolveNavSceneId(id: WorkspaceSceneId): WorkspaceSceneId | null {
  if (typeof id === 'string' && id.startsWith('live-app:')) return null;
  return getSceneNav(id) ? id : null;
}

function syncSceneNav(surface: WorkspaceSurface): void {
  const navStore = useNavSceneStore.getState();

  if (surface.kind !== 'scene') {
    navStore.closeNavScene();
    return;
  }

  const navId = resolveNavSceneId(surface.sceneId);
  if (navId) {
    navStore.openNavScene(navId);
  } else {
    navStore.closeNavScene();
  }
}

export const useWorkspaceSurfaceStore = create<WorkspaceSurfaceState>((set, get) => ({
  activeSurface: { kind: 'dispatcher-home', dispatcherSessionId: null },
  previousSurface: null,

  openSurface: (surface) => {
    const current = get().activeSurface;
    if (isSameWorkspaceSurface(current, surface)) {
      syncSceneNav(surface);
      return;
    }

    set({
      activeSurface: surface,
      previousSurface: current,
    });
    syncSceneNav(surface);
  },

  returnHome: (dispatcherSessionId = null) => {
    get().openSurface({ kind: 'dispatcher-home', dispatcherSessionId });
  },
}));

export function selectActiveSceneFromSurface(state: WorkspaceSurfaceState): WorkspaceSceneId | null {
  return state.activeSurface.kind === 'scene' ? state.activeSurface.sceneId : null;
}

export function selectIsHomeSurface(state: WorkspaceSurfaceState): boolean {
  return state.activeSurface.kind === 'dispatcher-home';
}
