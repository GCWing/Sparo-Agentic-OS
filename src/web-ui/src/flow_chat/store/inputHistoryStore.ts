/**
 * Input history store for navigating previously sent messages.
 * Provides terminal-like up/down arrow navigation through message history.
 * History is session-scoped - each session maintains its own input history.
 * Entries carry a timestamp for unified Trie-based autocomplete merging and eviction.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface HistoryEntry {
  /** The message text, trimmed. */
  text: string;
  /** Millisecond timestamp (Date.now()) when the message was sent. */
  timestamp: number;
}

export interface InputHistoryState {
  /** Map of sessionId to list of previously sent messages (most recent first). */
  messagesBySession: Record<string, HistoryEntry[]>;
  /** Maximum number of messages to keep per session. */
  maxHistorySize: number;

  /** Add a message to history for a specific session. */
  addMessage: (sessionId: string, message: string) => void;
  /** Clear history for a specific session (or all if no sessionId). */
  clearHistory: (sessionId?: string) => void;
  /** Get message text at index for a specific session (0 = most recent). */
  getMessage: (sessionId: string, index: number) => string | null;
  /** Get total count for a specific session. */
  getCount: (sessionId: string) => number;
  /** Get all history texts for a specific session (most recent first). */
  getSessionHistory: (sessionId: string) => string[];
}

export const useInputHistoryStore = create<InputHistoryState>()(
  persist(
    (set, get) => ({
      messagesBySession: {},
      maxHistorySize: 100,

      addMessage: (sessionId: string, message: string) => {
        const trimmed = message.trim();
        if (!trimmed || !sessionId) return;

        set((state) => {
          const sessionHistory = state.messagesBySession[sessionId] || [];
          const now = Date.now();

          // Deduplicate: if the latest entry is the same text, only bump its timestamp.
          if (sessionHistory[0]?.text === trimmed) {
            const updated = [...sessionHistory];
            updated[0] = { text: trimmed, timestamp: now };
            return {
              messagesBySession: {
                ...state.messagesBySession,
                [sessionId]: updated,
              },
            };
          }

          // Remove any older entry with the same text so it can be re-inserted at front.
          const filtered = sessionHistory.filter((m) => m.text !== trimmed);

          // Add to front, limit size.
          const newMessages: HistoryEntry[] = [
            { text: trimmed, timestamp: now },
            ...filtered,
          ].slice(0, state.maxHistorySize);

          return {
            messagesBySession: {
              ...state.messagesBySession,
              [sessionId]: newMessages,
            },
          };
        });
      },

      clearHistory: (sessionId?: string) => {
        if (!sessionId) {
          // Clear all history
          set({ messagesBySession: {} });
        } else {
          // Clear only specific session
          set((state) => {
            const newHistory = { ...state.messagesBySession };
            delete newHistory[sessionId];
            return { messagesBySession: newHistory };
          });
        }
      },

      getMessage: (sessionId: string, index: number) => {
        const { messagesBySession } = get();
        const sessionHistory = messagesBySession[sessionId] || [];
        if (index < 0 || index >= sessionHistory.length) return null;
        return sessionHistory[index].text;
      },

      getCount: (sessionId: string) => {
        const { messagesBySession } = get();
        return (messagesBySession[sessionId] || []).length;
      },

      getSessionHistory: (sessionId: string) => {
        const { messagesBySession } = get();
        const entries = messagesBySession[sessionId] || [];
        return entries.map((e) => e.text);
      },
    }),
    {
      name: 'sparo-input-history',
      version: 3,
      migrate: (persistedState: any, version: number) => {
        if (version < 2) {
          // Migrate from old global format to session-scoped format.
          persistedState = {
            messagesBySession: {},
            maxHistorySize: persistedState.maxHistorySize || 100,
          };
        }
        if (version < 3) {
          // Migrate from string[] to HistoryEntry[].
          const oldMap = persistedState.messagesBySession || {};
          const migrated: Record<string, HistoryEntry[]> = {};
          const now = Date.now();
          for (const [sid, msgs] of Object.entries(oldMap)) {
            if (!Array.isArray(msgs)) {
              migrated[sid] = [];
              continue;
            }
            const first = msgs[0];
            if (typeof first === 'string') {
              // Old format: string[]
              migrated[sid] = (msgs as string[]).map((text) => ({
                text,
                timestamp: now,
              }));
            } else if (first != null && typeof first === 'object' && 'text' in (first as object)) {
              // Already HistoryEntry[] — keep as-is.
              migrated[sid] = msgs as HistoryEntry[];
            } else {
              migrated[sid] = [];
            }
          }
          return {
            messagesBySession: migrated,
            maxHistorySize: persistedState.maxHistorySize || 100,
          };
        }
        return persistedState;
      },
    }
  )
);