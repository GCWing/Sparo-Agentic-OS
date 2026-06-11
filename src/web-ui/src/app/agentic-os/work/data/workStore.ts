import { create } from 'zustand';
import { createLogger } from '@/shared/utils/logger';
import { agenticOsWorkApi } from './workApi';
import type {
  AdvanceWorkRequest,
  ControlWorkRequest,
  CreateWorkRequest,
  UpdateWorkRequest,
  WorkRecord,
} from '../domain/workTypes';

const log = createLogger('WorkStore');
let pendingRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshInFlight = false;
let refreshQueued = false;

interface WorkStoreState {
  works: WorkRecord[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  refreshWorks: () => Promise<void>;
  getWork: (workId: string) => Promise<WorkRecord>;
  createWork: (request: CreateWorkRequest) => Promise<WorkRecord>;
  updateWork: (request: UpdateWorkRequest) => Promise<WorkRecord>;
  advanceWork: (request: AdvanceWorkRequest) => Promise<WorkRecord>;
  controlWork: (request: ControlWorkRequest) => Promise<WorkRecord>;
}

function upsertWork(works: WorkRecord[], next: WorkRecord): WorkRecord[] {
  const index = works.findIndex((work) => work.id === next.id);
  if (index < 0) return [next, ...works];
  const copy = works.slice();
  copy[index] = next;
  return copy;
}

export const useWorkStore = create<WorkStoreState>((set, get) => ({
  works: [],
  loaded: false,
  loading: false,
  error: null,

  refreshWorks: async () => {
    set({ loading: true, error: null });
    try {
      const works = await agenticOsWorkApi.listWorks();
      set({ works, loaded: true, loading: false });
    } catch (error) {
      log.error('Failed to load works', { error });
      set({
        error: error instanceof Error ? error.message : String(error),
        loaded: true,
        loading: false,
      });
    }
  },

  createWork: async (request) => {
    const work = await agenticOsWorkApi.createWork(request);
    set({ works: upsertWork(get().works, work), loaded: true });
    return work;
  },

  getWork: async (workId) => {
    const work = await agenticOsWorkApi.getWork(workId);
    set({ works: upsertWork(get().works, work), loaded: true });
    return work;
  },

  updateWork: async (request) => {
    const work = await agenticOsWorkApi.updateWork(request);
    set({ works: upsertWork(get().works, work), loaded: true });
    return work;
  },

  advanceWork: async (request) => {
    const work = await agenticOsWorkApi.advanceWork(request);
    set({ works: upsertWork(get().works, work), loaded: true });
    return work;
  },

  controlWork: async (request) => {
    const work = await agenticOsWorkApi.controlWork(request);
    set({ works: upsertWork(get().works, work), loaded: true });
    return work;
  },
}));

export function requestWorkRefresh(reason: string): void {
  if (pendingRefreshTimer) {
    clearTimeout(pendingRefreshTimer);
  }

  pendingRefreshTimer = setTimeout(() => {
    pendingRefreshTimer = null;
    void runRequestedRefresh(reason);
  }, 150);
}

async function runRequestedRefresh(reason: string): Promise<void> {
  if (refreshInFlight) {
    refreshQueued = true;
    return;
  }

  refreshInFlight = true;
  try {
    log.debug('Refreshing works from agentic event', { reason });
    await useWorkStore.getState().refreshWorks();
  } finally {
    refreshInFlight = false;
    if (refreshQueued) {
      refreshQueued = false;
      requestWorkRefresh('queued');
    }
  }
}
