import { create } from 'zustand';

interface PendingExcelLiveLaunch {
  filePath: string;
  ownerToken: string | null;
}

interface ExcelLiveLaunchState {
  pendingPaths: Record<string, PendingExcelLiveLaunch>;
  setPendingPath: (launchKey: string, path: string, ownerToken?: string) => void;
  /** Read the pending path without clearing it (safe before iframe is ready). */
  peekPendingPath: (launchKey: string) => string | null;
  consumePendingPath: (launchKey: string) => string | null;
  /** Clear only the launch owned by ownerToken when one is provided. */
  clearPendingPath: (launchKey: string, ownerToken?: string) => void;
}

export const useExcelLiveLaunchStore = create<ExcelLiveLaunchState>((set, get) => ({
  pendingPaths: {},
  setPendingPath: (launchKey, path, ownerToken) => set(state => ({
    pendingPaths: {
      ...state.pendingPaths,
      [launchKey]: { filePath: path, ownerToken: ownerToken ?? null },
    },
  })),
  peekPendingPath: (launchKey) => get().pendingPaths[launchKey]?.filePath ?? null,
  consumePendingPath: (launchKey) => {
    const path = get().pendingPaths[launchKey]?.filePath ?? null;
    set(state => {
      if (!(launchKey in state.pendingPaths)) return state;
      const pendingPaths = { ...state.pendingPaths };
      delete pendingPaths[launchKey];
      return { pendingPaths };
    });
    return path;
  },
  clearPendingPath: (launchKey, ownerToken) => set(state => {
    const pending = state.pendingPaths[launchKey];
    if (!pending || (ownerToken !== undefined && pending.ownerToken !== ownerToken)) return state;
    const pendingPaths = { ...state.pendingPaths };
    delete pendingPaths[launchKey];
    return { pendingPaths };
  }),
}));
