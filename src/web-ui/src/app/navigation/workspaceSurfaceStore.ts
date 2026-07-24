import { create } from 'zustand';
import { getSceneNav } from '../scenes/nav-registry';
import { useNavSceneStore } from '../stores/navSceneStore';
import type { WorkspaceSceneId } from './workspaceSceneTypes';
import {
  createAgenticOsHomeSurface,
  isSameWorkspaceSurface,
  type WorkspaceSurfaceContext,
  type WorkspaceSurface,
} from './workspaceSurfaceTypes';
import { systemRuntimeScope } from '@/shared/types/runtime-scope';
import {
  forgetSessionAuxiliarySurfaces,
  synchronizeAuxiliarySurface,
} from '@/app/auxiliary-surface/navigationSync';

export const WORKSPACE_SCENE_HISTORY_LIMIT = 5;

export type WorkspaceHistorySurface = Exclude<WorkspaceSurface, { kind: 'agentic-os-home' }>;

export interface WorkspaceSceneHistoryEntry {
  surface: WorkspaceHistorySurface;
  context: WorkspaceSurfaceContext | null;
  visitedAt: number;
}

export type WorkspaceSurfaceHistoryMode = 'push' | 'restore';

export interface OpenSurfaceOptions {
  context?: WorkspaceSurfaceContext | null;
  historyMode?: WorkspaceSurfaceHistoryMode;
  /** When opening agentic-os-home, sets which OS session is shown on the home surface. */
  currentOsSessionId?: string | null;
}

interface WorkspaceSurfaceState {
  activeSurface: WorkspaceSurface;
  previousSurface: WorkspaceSurface | null;
  currentOsSessionId: string | null;
  sceneHistory: WorkspaceSceneHistoryEntry[];
  surfaceContext: WorkspaceSurfaceContext | null;
  openSurface: (surface: WorkspaceSurface, options?: OpenSurfaceOptions) => void;
  goBackScene: () => boolean;
  openSceneHistoryEntry: (index: number) => boolean;
  clearSceneHistory: () => void;
  clearSurfaceContext: () => void;
  forgetSessions: (sessionIds: readonly string[]) => void;
  returnHome: (currentOsSessionId?: string | null) => void;
}

function resolveNavSceneId(id: WorkspaceSceneId): WorkspaceSceneId | null {
  if (typeof id === 'string' && id.startsWith('app-surface:')) return null;
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

function isSameHistorySurface(
  a: WorkspaceHistorySurface,
  b: WorkspaceHistorySurface
): boolean {
  return isSameWorkspaceSurface(a, b);
}

function shouldCaptureCurrentScene(
  current: WorkspaceSurface,
  next: WorkspaceSurface,
  mode: WorkspaceSurfaceHistoryMode
): current is WorkspaceHistorySurface {
  if (mode === 'restore') return false;
  if (current.kind === 'agentic-os-home') return false;
  return next.kind !== 'agentic-os-home';
}

function pushSceneHistory(
  history: WorkspaceSceneHistoryEntry[],
  surface: WorkspaceHistorySurface,
  context: WorkspaceSurfaceContext | null
): WorkspaceSceneHistoryEntry[] {
  const withoutDuplicate = history.filter(entry => !isSameHistorySurface(entry.surface, surface));
  return [
    {
      surface,
      context,
      visitedAt: Date.now(),
    },
    ...withoutDuplicate,
  ].slice(0, WORKSPACE_SCENE_HISTORY_LIMIT);
}

export function selectFocusedSessionId(state: WorkspaceSurfaceState): string | null {
  if (state.activeSurface.kind === 'session') {
    return state.activeSurface.sessionId;
  }
  if (state.activeSurface.kind === 'agentic-os-home') {
    return state.currentOsSessionId;
  }
  return null;
}

export const selectComposerTargetSessionId = selectFocusedSessionId;

export const useWorkspaceSurfaceStore = create<WorkspaceSurfaceState>((set, get) => ({
  activeSurface: createAgenticOsHomeSurface(),
  previousSurface: null,
  currentOsSessionId: null,
  sceneHistory: [],
  surfaceContext: null,

  openSurface: (surface, options = {}) => {
    const state = get();
    const current = state.activeSurface;
    const nextSurfaceContext = options.context ?? null;
    const nextCurrentOsSessionId =
      surface.kind === 'agentic-os-home'
        ? (options.currentOsSessionId !== undefined
          ? options.currentOsSessionId
          : state.currentOsSessionId)
        : state.currentOsSessionId;

    if (isSameWorkspaceSurface(current, surface)) {
      synchronizeAuxiliarySurface(surface, nextCurrentOsSessionId);
      set({
        sceneHistory: surface.kind === 'agentic-os-home' ? [] : state.sceneHistory,
        surfaceContext: nextSurfaceContext,
        currentOsSessionId: nextCurrentOsSessionId,
      });
      syncSceneNav(surface);
      return;
    }

    const historyMode = options.historyMode ?? 'push';
    const nextSceneHistory =
      surface.kind === 'agentic-os-home'
        ? []
        : shouldCaptureCurrentScene(current, surface, historyMode)
          ? pushSceneHistory(state.sceneHistory, current, state.surfaceContext)
          : state.sceneHistory;
    synchronizeAuxiliarySurface(surface, nextCurrentOsSessionId);
    set({
      activeSurface: surface,
      previousSurface: current,
      sceneHistory: nextSceneHistory,
      surfaceContext: nextSurfaceContext,
      currentOsSessionId: nextCurrentOsSessionId,
    });
    syncSceneNav(surface);
  },

  goBackScene: () => {
    const state = get();
    if (state.activeSurface.kind === 'agentic-os-home') return false;
    const entry = state.sceneHistory[0];
    if (!entry) return false;
    return get().openSceneHistoryEntry(0);
  },

  openSceneHistoryEntry: (index) => {
    const state = get();
    if (state.activeSurface.kind === 'agentic-os-home') return false;
    const entry = state.sceneHistory[index];
    if (!entry) return false;

    const nextHistory = state.sceneHistory.filter((_, i) => i !== index);
    synchronizeAuxiliarySurface(entry.surface, state.currentOsSessionId);
    set({
      activeSurface: entry.surface,
      previousSurface: state.activeSurface,
      sceneHistory: nextHistory,
      surfaceContext: entry.context,
      currentOsSessionId: state.currentOsSessionId,
    });
    syncSceneNav(entry.surface);
    return true;
  },

  clearSceneHistory: () => {
    set({ sceneHistory: [] });
  },

  clearSurfaceContext: () => {
    set({ surfaceContext: null });
  },

  forgetSessions: (sessionIds) => {
    if (sessionIds.length === 0) return;
    const removedSessionIds = new Set(sessionIds);
    forgetSessionAuxiliarySurfaces(sessionIds);

    set((state) => {
      const activeSurface =
        state.activeSurface.kind === 'session' && removedSessionIds.has(state.activeSurface.sessionId)
          ? createAgenticOsHomeSurface()
          : state.activeSurface;

      const nextCurrentOsSessionId =
        state.currentOsSessionId && removedSessionIds.has(state.currentOsSessionId)
          ? null
          : state.currentOsSessionId;

      const nextSceneHistory = state.sceneHistory.filter((entry) => (
        entry.surface.kind !== 'session' || !removedSessionIds.has(entry.surface.sessionId)
      ));

      return {
        activeSurface,
        surfaceContext: activeSurface === state.activeSurface ? state.surfaceContext : null,
        sceneHistory: activeSurface.kind === 'agentic-os-home' ? [] : nextSceneHistory,
        currentOsSessionId: nextCurrentOsSessionId,
      };
    });
    const next = get();
    synchronizeAuxiliarySurface(next.activeSurface, next.currentOsSessionId);
    syncSceneNav(get().activeSurface);
  },

  returnHome: (currentOsSessionId) => {
    get().openSurface(createAgenticOsHomeSurface(), {
      currentOsSessionId: currentOsSessionId !== undefined ? currentOsSessionId : get().currentOsSessionId,
    });
  },
}));

export function selectActiveSceneFromSurface(state: WorkspaceSurfaceState): WorkspaceSceneId | null {
  return state.activeSurface.kind === 'scene' ? state.activeSurface.sceneId : null;
}

export function selectIsHomeSurface(state: WorkspaceSurfaceState): boolean {
  return state.activeSurface.kind === 'agentic-os-home';
}

export function selectCanGoBackScene(state: WorkspaceSurfaceState): boolean {
  return state.activeSurface.kind !== 'agentic-os-home' && state.sceneHistory.length > 0;
}

/** @deprecated Use selectFocusedSessionId instead */
export function getFocusedSessionIdFromSurface(state: WorkspaceSurfaceState): string | null {
  return selectFocusedSessionId(state);
}

export function homeSurfaceWithScope(): WorkspaceSurface {
  return createAgenticOsHomeSurface();
}

export { systemRuntimeScope };
