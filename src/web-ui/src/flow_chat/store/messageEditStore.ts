import { create } from 'zustand';

export interface MessageEditKey {
  sessionId: string;
  turnId: string;
}

interface MessageEditState {
  activeEditKey: MessageEditKey | null;
  drafts: Record<string, string>;
  submitting: Record<string, boolean>;
  beginEdit: (key: MessageEditKey, initialDraft: string) => void;
  cancelEdit: (key: MessageEditKey) => void;
  setDraft: (key: MessageEditKey, draft: string) => void;
  setSubmitting: (key: MessageEditKey, submitting: boolean) => void;
  getDraft: (key: MessageEditKey) => string | undefined;
  isActive: (key: MessageEditKey) => boolean;
  isSubmitting: (key: MessageEditKey) => boolean;
}

export function getMessageEditKey(key: MessageEditKey): string {
  return `${key.sessionId}:${key.turnId}`;
}

export const useMessageEditStore = create<MessageEditState>((set, get) => ({
  activeEditKey: null,
  drafts: {},
  submitting: {},

  beginEdit: (key, initialDraft) => {
    const id = getMessageEditKey(key);
    set(state => ({
      activeEditKey: key,
      drafts: {
        ...state.drafts,
        [id]: state.drafts[id] ?? initialDraft,
      },
    }));
  },

  cancelEdit: key => {
    const id = getMessageEditKey(key);
    set(state => {
      const nextDrafts = { ...state.drafts };
      const nextSubmitting = { ...state.submitting };
      delete nextDrafts[id];
      delete nextSubmitting[id];

      return {
        activeEditKey: state.activeEditKey && getMessageEditKey(state.activeEditKey) === id
          ? null
          : state.activeEditKey,
        drafts: nextDrafts,
        submitting: nextSubmitting,
      };
    });
  },

  setDraft: (key, draft) => {
    const id = getMessageEditKey(key);
    set(state => ({
      drafts: {
        ...state.drafts,
        [id]: draft,
      },
    }));
  },

  setSubmitting: (key, submitting) => {
    const id = getMessageEditKey(key);
    set(state => ({
      submitting: {
        ...state.submitting,
        [id]: submitting,
      },
    }));
  },

  getDraft: key => get().drafts[getMessageEditKey(key)],

  isActive: key => {
    const active = get().activeEditKey;
    return !!active && getMessageEditKey(active) === getMessageEditKey(key);
  },

  isSubmitting: key => get().submitting[getMessageEditKey(key)] === true,
}));
