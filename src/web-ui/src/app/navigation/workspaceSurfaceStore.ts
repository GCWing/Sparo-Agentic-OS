import { create } from 'zustand';
import { getSceneNav } from '../scenes/nav-registry';
import { useNavSceneStore } from '../stores/navSceneStore';
import type { WorkspaceSceneId } from './workspaceSceneTypes';
import {
  isSameWorkspaceSurface,
  type WorkspaceSurfaceContext,
  type WorkspaceSurface,
} from './workspaceSurfaceTypes';

interface OpenSurfaceOptions {
  context?: WorkspaceSurfaceContext | null;
}

interface WorkspaceSurfaceState {
  activeSurface: WorkspaceSurface;
  previousSurface: WorkspaceSurface | null;
  surfaceContext: WorkspaceSurfaceContext | null;
  focusedSessionId: string | null;
  composerTargetSessionId: string | null;
  openSurface: (surface: WorkspaceSurface, options?: OpenSurfaceOptions) => void;
  focusSession: (sessionId: string | null) => void;
  setComposerTargetSession: (sessionId: string | null) => void;
  clearSurfaceContext: () => void;
  forgetSessions: (sessionIds: readonly string[]) => void;
  returnHome: (agenticOsSessionId?: string | null) => void;
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
  activeSurface: { kind: 'agentic-os-home', agenticOsSessionId: null },
  previousSurface: null,
  surfaceContext: null,
  focusedSessionId: null,
  composerTargetSessionId: null,

  openSurface: (surface, options = {}) => {
    const current = get().activeSurface;
    const nextSurfaceContext = options.context ?? null;
    const nextFocusedSessionId =
      surface.kind === 'session'
        ? surface.sessionId
        : surface.kind === 'agentic-os-home'
          ? surface.agenticOsSessionId
          : null;
    if (isSameWorkspaceSurface(current, surface)) {
      set({
        surfaceContext: nextSurfaceContext,
        focusedSessionId: nextFocusedSessionId,
        composerTargetSessionId: nextFocusedSessionId,
      });
      syncSceneNav(surface);
      return;
    }

    set({
      activeSurface: surface,
      previousSurface: current,
      surfaceContext: nextSurfaceContext,
      focusedSessionId: nextFocusedSessionId,
      composerTargetSessionId: nextFocusedSessionId,
    });
    syncSceneNav(surface);
  },

  focusSession: (sessionId) => {
    set({
      focusedSessionId: sessionId,
      composerTargetSessionId: sessionId,
    });
  },

  setComposerTargetSession: (sessionId) => {
    set({ composerTargetSessionId: sessionId });
  },

  clearSurfaceContext: () => {
    set({ surfaceContext: null });
  },

  forgetSessions: (sessionIds) => {
    if (sessionIds.length === 0) return;
    const removedSessionIds = new Set(sessionIds);

    set((state) => {
      const activeSurface =
        state.activeSurface.kind === 'session' && removedSessionIds.has(state.activeSurface.sessionId)
          ? { kind: 'agentic-os-home', agenticOsSessionId: null } as WorkspaceSurface
          : state.activeSurface.kind === 'agentic-os-home' &&
              state.activeSurface.agenticOsSessionId &&
              removedSessionIds.has(state.activeSurface.agenticOsSessionId)
            ? { kind: 'agentic-os-home', agenticOsSessionId: null } as WorkspaceSurface
            : state.activeSurface;

      return {
        activeSurface,
        surfaceContext: activeSurface === state.activeSurface ? state.surfaceContext : null,
        focusedSessionId:
          state.focusedSessionId && removedSessionIds.has(state.focusedSessionId)
            ? null
            : state.focusedSessionId,
        composerTargetSessionId:
          state.composerTargetSessionId && removedSessionIds.has(state.composerTargetSessionId)
            ? null
            : state.composerTargetSessionId,
      };
    });
    syncSceneNav(get().activeSurface);
  },

  returnHome: (agenticOsSessionId = null) => {
    get().openSurface({ kind: 'agentic-os-home', agenticOsSessionId });
  },
}));

export function selectActiveSceneFromSurface(state: WorkspaceSurfaceState): WorkspaceSceneId | null {
  return state.activeSurface.kind === 'scene' ? state.activeSurface.sceneId : null;
}

export function selectIsHomeSurface(state: WorkspaceSurfaceState): boolean {
  return state.activeSurface.kind === 'agentic-os-home';
}
