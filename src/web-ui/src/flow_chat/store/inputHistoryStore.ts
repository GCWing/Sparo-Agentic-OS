import { create } from 'zustand';
import type { ComposerContextSnapshot } from '@/shared/types/composer';

export interface InputHistoryEntry {
  displayText: string;
  composerContext: ComposerContextSnapshot;
}

export interface InputHistoryState {
  entriesBySession: Record<string, InputHistoryEntry[]>;
  maxHistorySize: number;
  addMessage: (
    sessionId: string,
    displayText: string,
    composerContext: ComposerContextSnapshot,
  ) => void;
  clearHistory: (sessionId?: string) => void;
  getMessage: (sessionId: string, index: number) => InputHistoryEntry | null;
  getCount: (sessionId: string) => number;
  getSessionHistory: (sessionId: string) => InputHistoryEntry[];
}

export const useInputHistoryStore = create<InputHistoryState>()(
  (set, get) => ({
    entriesBySession: {},
    maxHistorySize: 100,
    addMessage: (sessionId, displayText, composerContext) => {
      const trimmed = displayText.trim();
      if (!trimmed || !sessionId) return;
      set(state => {
        const history = state.entriesBySession[sessionId] || [];
        const filtered = history.filter(entry => entry.displayText !== trimmed);
        const entries = [{ displayText: trimmed, composerContext }, ...filtered]
          .slice(0, state.maxHistorySize);
        return {
          entriesBySession: { ...state.entriesBySession, [sessionId]: entries },
        };
      });
    },
    clearHistory: (sessionId) => {
      if (!sessionId) {
        set({ entriesBySession: {} });
        return;
      }
      set(state => {
        const entriesBySession = { ...state.entriesBySession };
        delete entriesBySession[sessionId];
        return { entriesBySession };
      });
    },
    getMessage: (sessionId, index) => get().entriesBySession[sessionId]?.[index] ?? null,
    getCount: sessionId => get().entriesBySession[sessionId]?.length ?? 0,
    getSessionHistory: sessionId => get().entriesBySession[sessionId] || [],
  }),
);
