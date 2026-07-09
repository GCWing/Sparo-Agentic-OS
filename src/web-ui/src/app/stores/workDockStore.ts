import { create } from 'zustand';
import type { WorkCategory } from '@/app/agentic-os/work/domain/workClassification';
import type { WorkAppRef } from '@/app/agentic-os/work/domain/workTypes';

export type WorkCenterScope =
  | { kind: 'open' }
  | { kind: 'attention' }
  | { kind: 'running' }
  | { kind: 'all' }
  | { kind: 'completed' }
  | { kind: 'archived' }
  | { kind: 'category'; category: WorkCategory }
  | { kind: 'topic' }
  | { kind: 'system' }
  | { kind: 'workspaces' };

export type WorkCenterWorkspaceFilter =
  | { kind: 'all' }
  | { kind: 'workspace'; id: string };

export type WorkCenterAppFilter =
  | { kind: 'all' }
  | { kind: 'app'; app: WorkAppRef };

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

  workCenterAppFilter: WorkCenterAppFilter;
  setWorkCenterAppFilter: (filter: WorkCenterAppFilter) => void;

  workCenterGrouping: WorkCenterGrouping;
  setWorkCenterGrouping: (grouping: WorkCenterGrouping) => void;

  workCenterSelectedWorkId: string | null;
  setWorkCenterSelectedWorkId: (workId: string | null) => void;

  workCenterSelectedArtifactId: string | null;
  setWorkCenterSelectedArtifactId: (artifactId: string | null) => void;

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

  workCenterAppFilter: { kind: 'all' },
  setWorkCenterAppFilter: (filter) => set({ workCenterAppFilter: filter }),

  workCenterGrouping: 'priority',
  setWorkCenterGrouping: (grouping) => set({ workCenterGrouping: grouping }),

  workCenterSelectedWorkId: null,
  setWorkCenterSelectedWorkId: (workId) => set({ workCenterSelectedWorkId: workId }),

  workCenterSelectedArtifactId: null,
  setWorkCenterSelectedArtifactId: (artifactId) => set({ workCenterSelectedArtifactId: artifactId }),

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
