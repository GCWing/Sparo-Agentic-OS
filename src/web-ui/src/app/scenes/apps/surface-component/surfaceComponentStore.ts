/**
 * Product App scene store — app catalog + lifecycle state.
 */
import { create } from 'zustand';
import type { SurfaceComponentMeta, RuntimeStatus } from '@/infrastructure/api/service-api/SurfaceComponentAPI';

const RECENT_SURFACE_COMPONENT_LIMIT = 12;

interface SurfaceComponentState {
  apps: SurfaceComponentMeta[];
  loading: boolean;
  runtimeStatus: RuntimeStatus | null;
  /** App IDs whose scenes are currently open in the viewport. */
  openedAppIds: string[];
  /** App IDs most recently opened by the user, newest first. Synced from Rust persistence. */
  recentAppIds: string[];
  /** App IDs that should be shown as long-lived runnable app tasks. */
  runningAppIds: string[];
  /** App IDs whose JS workers are currently running. */
  runningWorkerIds: string[];
  /** AppStudio sessions currently associated with a generated app. */
  sessionAppIds: Record<string, string>;

  setApps: (apps: SurfaceComponentMeta[]) => void;
  setLoading: (loading: boolean) => void;
  setRuntimeStatus: (status: RuntimeStatus | null) => void;
  setRecentAppIds: (ids: string[]) => void;
  openApp: (id: string) => void;
  closeApp: (id: string) => void;
  markAppRunning: (id: string) => void;
  markAppStopped: (id: string) => void;
  setRunningWorkerIds: (ids: string[]) => void;
  markWorkerRunning: (id: string) => void;
  markWorkerStopped: (id: string) => void;
  bindSessionApp: (sessionId: string, appId: string) => void;
}

function rememberRecentApp(ids: string[], id: string): string[] {
  return [id, ...ids.filter((value) => value !== id)].slice(0, RECENT_SURFACE_COMPONENT_LIMIT);
}

export const useSurfaceComponentStore = create<SurfaceComponentState>((set) => ({
  apps: [],
  loading: false,
  runtimeStatus: null,
  openedAppIds: [],
  recentAppIds: [],
  runningAppIds: [],
  runningWorkerIds: [],
  sessionAppIds: {},

  setApps: (apps) =>
    set((state) => {
      const validIds = new Set(apps.map((app) => app.id));
      return {
        apps,
        openedAppIds: state.openedAppIds.filter((id) => validIds.has(id)),
        recentAppIds: state.recentAppIds.filter((id) => validIds.has(id)),
        runningAppIds: state.runningAppIds.filter((id) => validIds.has(id)),
        runningWorkerIds: state.runningWorkerIds.filter((id) => validIds.has(id)),
      };
    }),
  setLoading: (loading) => set({ loading }),
  setRuntimeStatus: (runtimeStatus) => set({ runtimeStatus }),
  setRecentAppIds: (ids) =>
    set((state) => {
      const validIds = new Set(state.apps.map((app) => app.id));
      return {
        recentAppIds: Array.from(new Set(ids))
          .filter((id) => validIds.size === 0 || validIds.has(id))
          .slice(0, RECENT_SURFACE_COMPONENT_LIMIT),
      };
    }),

  openApp: (id) =>
    set((state) => ({
      openedAppIds: state.openedAppIds.includes(id) ? state.openedAppIds : [...state.openedAppIds, id],
      recentAppIds: rememberRecentApp(state.recentAppIds, id),
      runningAppIds: state.runningAppIds.includes(id) ? state.runningAppIds : [...state.runningAppIds, id],
    })),
  closeApp: (id) =>
    set((state) => ({
      openedAppIds: state.openedAppIds.filter((value) => value !== id),
    })),
  markAppRunning: (id) =>
    set((state) =>
      state.runningAppIds.includes(id) ? state : { runningAppIds: [...state.runningAppIds, id] }
    ),
  markAppStopped: (id) =>
    set((state) => ({
      runningAppIds: state.runningAppIds.filter((value) => value !== id),
      runningWorkerIds: state.runningWorkerIds.filter((value) => value !== id),
    })),
  setRunningWorkerIds: (ids) =>
    set((state) => {
      const nextWorkerIds = Array.from(new Set(ids));
      const nextAppIds = Array.from(new Set([...state.runningAppIds, ...nextWorkerIds]));
      return { runningWorkerIds: nextWorkerIds, runningAppIds: nextAppIds };
    }),
  markWorkerRunning: (id) =>
    set((state) => ({
      runningWorkerIds: state.runningWorkerIds.includes(id) ? state.runningWorkerIds : [...state.runningWorkerIds, id],
      runningAppIds: state.runningAppIds.includes(id) ? state.runningAppIds : [...state.runningAppIds, id],
    })),
  markWorkerStopped: (id) =>
    set((state) => ({
      runningWorkerIds: state.runningWorkerIds.filter((value) => value !== id),
      runningAppIds: state.runningAppIds.filter((value) => value !== id),
    })),
  bindSessionApp: (sessionId, appId) =>
    set((state) => ({
      sessionAppIds: { ...state.sessionAppIds, [sessionId]: appId },
    })),
}));
