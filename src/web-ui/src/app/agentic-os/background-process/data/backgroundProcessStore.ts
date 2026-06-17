import { create } from 'zustand';
import { createLogger } from '@/shared/utils/logger';
import type {
  BackgroundProcess,
  BackgroundProcessKind,
  RunBackgroundProcessResponse,
} from '../domain/backgroundProcessTypes';
import { backgroundProcessApi } from './backgroundProcessApi';

const log = createLogger('BackgroundProcessStore');

interface BackgroundProcessStoreState {
  processes: BackgroundProcess[];
  generatedAt: number | null;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  runningKind: BackgroundProcessKind | null;
  refreshProcesses: () => Promise<void>;
  runProcess: (kind: BackgroundProcessKind) => Promise<RunBackgroundProcessResponse>;
}

export const useBackgroundProcessStore = create<BackgroundProcessStoreState>((set, get) => ({
  processes: [],
  generatedAt: null,
  loaded: false,
  loading: false,
  error: null,
  runningKind: null,

  refreshProcesses: async () => {
    set({ loading: true, error: null });
    try {
      const response = await backgroundProcessApi.listProcesses();
      set({
        processes: response.processes,
        generatedAt: response.generatedAt,
        loaded: true,
        loading: false,
      });
    } catch (error) {
      log.error('Failed to load background processes', { error });
      set({
        error: error instanceof Error ? error.message : String(error),
        loaded: true,
        loading: false,
      });
    }
  },

  runProcess: async (kind) => {
    if (get().runningKind) {
      return {
        kind,
        started: false,
        reason: 'Another process action is already in flight',
      };
    }

    set({ runningKind: kind, error: null });
    try {
      const response = await backgroundProcessApi.runProcess(kind);
      await get().refreshProcesses();
      return response;
    } catch (error) {
      log.error('Failed to run background process', { kind, error });
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      set({ runningKind: null });
    }
  },
}));
