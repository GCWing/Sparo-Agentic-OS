import { create } from 'zustand';
import { createLogger } from '@/shared/utils/logger';
import { agenticOsWorkApi } from './workApi';
import type {
  AdvanceWorkRequest,
  ControlWorkRequest,
  CreateWorkRequest,
  LinkSessionToWorkRequest,
  ResolveAppWorkRequest,
  ResolveComponentWorkRequest,
  UpdateWorkRequest,
  WorkDeleteOptions,
  WorkDeleteResult,
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
  resolveAppWork: (request: ResolveAppWorkRequest) => Promise<{ work: WorkRecord; created: boolean }>;
  resolveComponentWork: (request: ResolveComponentWorkRequest) => Promise<{ work: WorkRecord; created: boolean }>;
  linkSessionToWork: (request: LinkSessionToWorkRequest) => Promise<WorkRecord>;
  updateWork: (request: UpdateWorkRequest) => Promise<WorkRecord>;
  advanceWork: (request: AdvanceWorkRequest) => Promise<WorkRecord>;
  controlWork: (request: ControlWorkRequest) => Promise<WorkRecord>;
  deleteWork: (workId: string, options?: WorkDeleteOptions) => Promise<WorkDeleteResult>;
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
    set({ works: upsertWork(get().works, work), loaded: true, loading: false, error: null });
    return work;
  },

  resolveAppWork: async (request) => {
    const response = await agenticOsWorkApi.resolveAppWork(request);
    set({ works: upsertWork(get().works, response.work), loaded: true, loading: false, error: null });
    return response;
  },

  resolveComponentWork: async (request) => {
    const response = await agenticOsWorkApi.resolveComponentWork(request);
    set({ works: upsertWork(get().works, response.work), loaded: true, loading: false, error: null });
    return response;
  },

  getWork: async (workId) => {
    const work = await agenticOsWorkApi.getWork(workId);
    set({ works: upsertWork(get().works, work), loaded: true, loading: false, error: null });
    return work;
  },

  updateWork: async (request) => {
    const work = await agenticOsWorkApi.updateWork(request);
    set({ works: upsertWork(get().works, work), loaded: true, loading: false, error: null });
    return work;
  },

  linkSessionToWork: async (request) => {
    const work = await agenticOsWorkApi.linkSessionToWork(request);
    set({ works: upsertWork(get().works, work), loaded: true, loading: false, error: null });
    return work;
  },

  advanceWork: async (request) => {
    const work = await agenticOsWorkApi.advanceWork(request);
    set({ works: upsertWork(get().works, work), loaded: true, loading: false, error: null });
    return work;
  },

  controlWork: async (request) => {
    const work = await agenticOsWorkApi.controlWork(request);
    set({ works: upsertWork(get().works, work), loaded: true, loading: false, error: null });
    return work;
  },

  deleteWork: async (workId, options) => {
    const result = await agenticOsWorkApi.deleteWork(workId, options);
    if (result.deleted) {
      set({
        works: get().works.filter((work) => work.id !== workId),
        loaded: true,
        loading: false,
        error: null,
      });
    }
    return result;
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
