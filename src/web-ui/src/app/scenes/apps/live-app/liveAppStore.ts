/**
 * Live App scene store — app catalog + lifecycle state.
 */
import { create } from 'zustand';
import type { LiveAppMeta, RuntimeStatus } from '@/infrastructure/api/service-api/LiveAppAPI';

interface LiveAppState {
  apps: LiveAppMeta[];
  loading: boolean;
  runtimeStatus: RuntimeStatus | null;
  /** App IDs whose scenes are currently open in the viewport. */
  openedAppIds: string[];
  /** App IDs that should be shown as long-lived runnable app tasks. */
  runningAppIds: string[];
  /** App IDs whose JS workers are currently running. */
  runningWorkerIds: string[];
  /** LiveAppStudio sessions currently associated with a generated app. */
  sessionAppIds: Record<string, string>;

  setApps: (apps: LiveAppMeta[]) => void;
  setLoading: (loading: boolean) => void;
  setRuntimeStatus: (status: RuntimeStatus | null) => void;
  openApp: (id: string) => void;
  closeApp: (id: string) => void;
  markAppRunning: (id: string) => void;
  markAppStopped: (id: string) => void;
  setRunningWorkerIds: (ids: string[]) => void;
  markWorkerRunning: (id: string) => void;
  markWorkerStopped: (id: string) => void;
  bindSessionApp: (sessionId: string, appId: string) => void;
}

export const useLiveAppStore = create<LiveAppState>((set) => ({
  apps: [],
  loading: false,
  runtimeStatus: null,
  openedAppIds: [],
  runningAppIds: [],
  runningWorkerIds: [],
  sessionAppIds: {},

  setApps: (apps) =>
    set((state) => {
      const validIds = new Set(apps.map((app) => app.id));
      return {
        apps,
        openedAppIds: state.openedAppIds.filter((id) => validIds.has(id)),
        runningAppIds: state.runningAppIds.filter((id) => validIds.has(id)),
        runningWorkerIds: state.runningWorkerIds.filter((id) => validIds.has(id)),
      };
    }),
  setLoading: (loading) => set({ loading }),
  setRuntimeStatus: (runtimeStatus) => set({ runtimeStatus }),

  openApp: (id) =>
    set((state) => ({
      openedAppIds: state.openedAppIds.includes(id) ? state.openedAppIds : [...state.openedAppIds, id],
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
