/**
 * sessionCapsuleStore — task detail dialog, left SessionCapsule expand signal,
 * and the left-side floating task management panel (TaskManagementPanel).
 *
 * UnifiedTopBar "view all tasks" calls requestExpandSessionList so the capsule
 * expands instead of opening a separate modal.
 */

import { create } from 'zustand';

export type TaskCenterScope =
  | { kind: 'running' }
  | { kind: 'system' }
  | { kind: 'workspace'; id: string };

export type TaskCenterGrouping = 'agent' | 'status' | 'time';
export type TaskCenterView = 'cards' | 'rows';

interface SessionCapsuleStore {
  /** Incremented to ask SessionCapsule to expand the left task list (e.g. from top bar). */
  sessionListExpandNonce: number;
  requestExpandSessionList: () => void;

  sessionListDialogOpen: boolean;
  openSessionListDialog: () => void;
  closeSessionListDialog: () => void;

  taskDetailSessionId: string | null;
  openTaskDetail: (sessionId: string) => void;
  closeTaskDetail: () => void;

  /** Whether the left-side floating task management panel is open. */
  taskPanelOpen: boolean;
  openTaskPanel: () => void;
  closeTaskPanel: () => void;
  toggleTaskPanel: () => void;

  /** Task Center scope selection (persisted across opens). */
  taskCenterScope: TaskCenterScope;
  setTaskCenterScope: (scope: TaskCenterScope) => void;

  /** Task Center board grouping dimension. */
  taskCenterGrouping: TaskCenterGrouping;
  setTaskCenterGrouping: (grouping: TaskCenterGrouping) => void;

  /** Task Center board view mode. */
  taskCenterView: TaskCenterView;
  setTaskCenterView: (view: TaskCenterView) => void;

  /** Collapsed agent group keys for the current view (stored as array for stable Zustand comparison). */
  taskCenterCollapsedGroups: string[];
  toggleTaskCenterGroupCollapsed: (key: string) => void;
  setTaskCenterGroupCollapsed: (key: string, collapsed: boolean) => void;
}

export const useSessionCapsuleStore = create<SessionCapsuleStore>((set) => ({
  sessionListExpandNonce: 0,
  requestExpandSessionList: () =>
    set((s) => ({
      sessionListExpandNonce: s.sessionListExpandNonce + 1,
      sessionListDialogOpen: false,
    })),

  sessionListDialogOpen: false,
  openSessionListDialog: () => set({ sessionListDialogOpen: true }),
  closeSessionListDialog: () => set({ sessionListDialogOpen: false }),

  taskDetailSessionId: null,
  openTaskDetail: (sessionId: string) => set({ taskDetailSessionId: sessionId }),
  closeTaskDetail: () => set({ taskDetailSessionId: null }),

  taskPanelOpen: false,
  openTaskPanel: () => set({ taskPanelOpen: true }),
  closeTaskPanel: () => set({ taskPanelOpen: false }),
  toggleTaskPanel: () => set((s) => ({ taskPanelOpen: !s.taskPanelOpen })),

  taskCenterScope: { kind: 'system' },
  setTaskCenterScope: (scope) => set({ taskCenterScope: scope }),

  taskCenterGrouping: 'agent',
  setTaskCenterGrouping: (grouping) => set({ taskCenterGrouping: grouping }),

  taskCenterView: 'cards',
  setTaskCenterView: (view) => set({ taskCenterView: view }),

  taskCenterCollapsedGroups: [],
  toggleTaskCenterGroupCollapsed: (key) =>
    set((s) => {
      const has = s.taskCenterCollapsedGroups.includes(key);
      return {
        taskCenterCollapsedGroups: has
          ? s.taskCenterCollapsedGroups.filter((k) => k !== key)
          : [...s.taskCenterCollapsedGroups, key],
      };
    }),
  setTaskCenterGroupCollapsed: (key, collapsed) =>
    set((s) => {
      const has = s.taskCenterCollapsedGroups.includes(key);
      if (collapsed && !has) return { taskCenterCollapsedGroups: [...s.taskCenterCollapsedGroups, key] };
      if (!collapsed && has) return { taskCenterCollapsedGroups: s.taskCenterCollapsedGroups.filter((k) => k !== key) };
      return s;
    }),
}));
