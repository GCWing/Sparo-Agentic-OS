import { create } from 'zustand';
import { getSceneNav } from '../scenes/nav-registry';
import { useNavSceneStore } from '../stores/navSceneStore';
import type { WorkspaceSceneId } from './workspaceSceneTypes';
import {
  isSameWorkspaceSurface,
  type WorkspaceSurfaceContext,
  type WorkspaceSurface,
} from './workspaceSurfaceTypes';

export const WORKSPACE_SCENE_HISTORY_LIMIT = 5;

export type WorkspaceHistorySurface = Exclude<WorkspaceSurface, { kind: 'agentic-os-home' }>;

export interface WorkspaceSceneHistoryEntry {
  surface: WorkspaceHistorySurface;
  context: WorkspaceSurfaceContext | null;
  visitedAt: number;
}

export type WorkspaceSurfaceHistoryMode = 'push' | 'restore';

interface OpenSurfaceOptions {
  context?: WorkspaceSurfaceContext | null;
  historyMode?: WorkspaceSurfaceHistoryMode;
}

interface WorkspaceSurfaceState {
  activeSurface: WorkspaceSurface;
  previousSurface: WorkspaceSurface | null;
  sceneHistory: WorkspaceSceneHistoryEntry[];
  surfaceContext: WorkspaceSurfaceContext | null;
  focusedSessionId: string | null;
  composerTargetSessionId: string | null;
  openSurface: (surface: WorkspaceSurface, options?: OpenSurfaceOptions) => void;
  goBackScene: () => boolean;
  openSceneHistoryEntry: (index: number) => boolean;
  clearSceneHistory: () => void;
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

function getFocusedSessionId(surface: WorkspaceSurface): string | null {
  return surface.kind === 'session'
    ? surface.sessionId
    : surface.kind === 'agentic-os-home'
      ? surface.agenticOsSessionId
      : null;
}

export const useWorkspaceSurfaceStore = create<WorkspaceSurfaceState>((set, get) => ({
  activeSurface: { kind: 'agentic-os-home', agenticOsSessionId: null },
  previousSurface: null,
  sceneHistory: [],
  surfaceContext: null,
  focusedSessionId: null,
  composerTargetSessionId: null,

  openSurface: (surface, options = {}) => {
    const state = get();
    const current = state.activeSurface;
    const nextSurfaceContext = options.context ?? null;
    const nextFocusedSessionId = getFocusedSessionId(surface);
    if (isSameWorkspaceSurface(current, surface)) {
      set({
        sceneHistory: surface.kind === 'agentic-os-home' ? [] : state.sceneHistory,
        surfaceContext: nextSurfaceContext,
        focusedSessionId: nextFocusedSessionId,
        composerTargetSessionId: nextFocusedSessionId,
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
    set({
      activeSurface: surface,
      previousSurface: current,
      sceneHistory: nextSceneHistory,
      surfaceContext: nextSurfaceContext,
      focusedSessionId: nextFocusedSessionId,
      composerTargetSessionId: nextFocusedSessionId,
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
    const nextFocusedSessionId = getFocusedSessionId(entry.surface);
    set({
      activeSurface: entry.surface,
      previousSurface: state.activeSurface,
      sceneHistory: nextHistory,
      surfaceContext: entry.context,
      focusedSessionId: nextFocusedSessionId,
      composerTargetSessionId: nextFocusedSessionId,
    });
    syncSceneNav(entry.surface);
    return true;
  },

  clearSceneHistory: () => {
    set({ sceneHistory: [] });
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

      const nextSceneHistory = state.sceneHistory.filter((entry) => (
        entry.surface.kind !== 'session' || !removedSessionIds.has(entry.surface.sessionId)
      ));

      return {
        activeSurface,
        surfaceContext: activeSurface === state.activeSurface ? state.surfaceContext : null,
        sceneHistory: activeSurface.kind === 'agentic-os-home' ? [] : nextSceneHistory,
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

export function selectCanGoBackScene(state: WorkspaceSurfaceState): boolean {
  return state.activeSurface.kind !== 'agentic-os-home' && state.sceneHistory.length > 0;
}
