import { create } from 'zustand';
import type { WorkCategory } from '@/app/agentic-os/work/domain/workClassification';

export type WorkCenterScope =
  | { kind: 'open' }
  | { kind: 'attention' }
  | { kind: 'running' }
  | { kind: 'all' }
  | { kind: 'completed' }
  | { kind: 'archived' }
  | { kind: 'category'; category: WorkCategory }
  | { kind: 'workspaces' };

export type WorkCenterWorkspaceFilter =
  | { kind: 'all' }
  | { kind: 'workspace'; id: string };

export type WorkCenterGrouping = 'priority' | 'kind' | 'status' | 'time';

interface WorkDockStore {
  workDockOpenNonce: number;
  requestOpenWorkDock: () => void;

  workPanelOpen: boolean;
  openWorkPanel: () => void;
  closeWorkPanel: () => void;
  toggleWorkPanel: () => void;

  workCenterScope: WorkCenterScope;
  setWorkCenterScope: (scope: WorkCenterScope) => void;

  workCenterWorkspaceFilter: WorkCenterWorkspaceFilter;
  setWorkCenterWorkspaceFilter: (filter: WorkCenterWorkspaceFilter) => void;

  workCenterGrouping: WorkCenterGrouping;
  setWorkCenterGrouping: (grouping: WorkCenterGrouping) => void;

  workCenterSelectedWorkId: string | null;
  setWorkCenterSelectedWorkId: (workId: string | null) => void;

  workCenterCollapsedGroups: string[];
  toggleWorkCenterGroupCollapsed: (key: string) => void;
  setWorkCenterGroupCollapsed: (key: string, collapsed: boolean) => void;
}

export const useWorkDockStore = create<WorkDockStore>((set) => ({
  workDockOpenNonce: 0,
  requestOpenWorkDock: () =>
    set((state) => ({
      workDockOpenNonce: state.workDockOpenNonce + 1,
    })),

  workPanelOpen: false,
  openWorkPanel: () => set({ workPanelOpen: true }),
  closeWorkPanel: () => set({ workPanelOpen: false }),
  toggleWorkPanel: () => set((state) => ({ workPanelOpen: !state.workPanelOpen })),

  workCenterScope: { kind: 'open' },
  setWorkCenterScope: (scope) => set({ workCenterScope: scope }),

  workCenterWorkspaceFilter: { kind: 'all' },
  setWorkCenterWorkspaceFilter: (filter) => set({ workCenterWorkspaceFilter: filter }),

  workCenterGrouping: 'priority',
  setWorkCenterGrouping: (grouping) => set({ workCenterGrouping: grouping }),

  workCenterSelectedWorkId: null,
  setWorkCenterSelectedWorkId: (workId) => set({ workCenterSelectedWorkId: workId }),

  workCenterCollapsedGroups: [],
  toggleWorkCenterGroupCollapsed: (key) =>
    set((state) => {
      const collapsed = state.workCenterCollapsedGroups.includes(key);
      return {
        workCenterCollapsedGroups: collapsed
          ? state.workCenterCollapsedGroups.filter((item) => item !== key)
          : [...state.workCenterCollapsedGroups, key],
      };
    }),
  setWorkCenterGroupCollapsed: (key, collapsed) =>
    set((state) => {
      const current = state.workCenterCollapsedGroups.includes(key);
      if (collapsed && !current) {
        return { workCenterCollapsedGroups: [...state.workCenterCollapsedGroups, key] };
      }
      if (!collapsed && current) {
        return {
          workCenterCollapsedGroups: state.workCenterCollapsedGroups.filter((item) => item !== key),
        };
      }
      return state;
    }),
}));
