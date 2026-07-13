import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { ComposerDocument } from '../types/composer';
import {
  createComposerTextDocument,
  EMPTY_COMPOSER_DOCUMENT,
  hasComposerContent,
  removeComposerContext,
} from '../types/composer';
import type { ContextItem, ValidationResult } from '../types/context';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('ComposerContextStore');
const DEFAULT_DRAFT_KEY = 'composer:unbound';

interface ComposerDraft {
  document: ComposerDocument;
  contexts: ContextItem[];
}

interface ContextState {
  activeDraftKey: string;
  drafts: Record<string, ComposerDraft>;
  contexts: ContextItem[];
  document: ComposerDocument;
  validationStates: Map<string, ValidationResult>;
  validatingIds: Set<string>;
  setActiveDraft: (draftKey: string) => void;
  setDocument: (document: ComposerDocument) => void;
  replaceDraftText: (text: string) => void;
  restoreDraft: (document: ComposerDocument, contexts: ContextItem[]) => void;
  restoreDraftIfEmpty: (document: ComposerDocument, contexts: ContextItem[]) => boolean;
  addContext: (item: ContextItem) => void;
  removeContext: (id: string) => void;
  clearContexts: () => void;
  clearDraft: () => void;
  updateValidation: (id: string, result: ValidationResult) => void;
  setValidating: (id: string, validating: boolean) => void;
  reorderContexts: (startIndex: number, endIndex: number) => void;
  updateContext: (draftKey: string, id: string, updates: Partial<ContextItem>) => void;
}

function emptyDraft(): ComposerDraft {
  return { document: { version: 1, nodes: [] }, contexts: [] };
}

function withActiveDraft(
  state: ContextState,
  update: (draft: ComposerDraft) => ComposerDraft,
): Partial<ContextState> {
  const current = state.drafts[state.activeDraftKey] ?? emptyDraft();
  const next = update(current);
  return {
    drafts: { ...state.drafts, [state.activeDraftKey]: next },
    document: next.document,
    contexts: next.contexts,
  };
}

/**
 * Draft-scoped Composer context state.
 *
 * Nothing is persisted to localStorage: contexts belong to a concrete draft,
 * and submitted snapshots are persisted with the dialog turn instead.
 */
export const useContextStore = create<ContextState>()(
  devtools((set, get) => ({
    activeDraftKey: DEFAULT_DRAFT_KEY,
    drafts: {},
    contexts: [],
    document: EMPTY_COMPOSER_DOCUMENT,
    validationStates: new Map(),
    validatingIds: new Set(),

    setActiveDraft: (draftKey) => {
      const normalizedKey = draftKey.trim() || DEFAULT_DRAFT_KEY;
      set((state) => {
        if (state.activeDraftKey === normalizedKey) return state;
        const draft = state.drafts[normalizedKey] ?? emptyDraft();
        return {
          activeDraftKey: normalizedKey,
          document: draft.document,
          contexts: draft.contexts,
          validationStates: new Map(),
          validatingIds: new Set(),
        };
      }, false, 'setActiveDraft');
    },

    setDocument: (document) => {
      set(state => withActiveDraft(state, draft => ({ ...draft, document })), false, 'setDocument');
    },

    replaceDraftText: (text) => {
      set(state => withActiveDraft(state, draft => ({
        ...draft,
        document: createComposerTextDocument(text),
        contexts: draft.contexts.filter(context => context.type === 'image'),
      })), false, 'replaceDraftText');
    },

    restoreDraft: (document, contexts) => {
      set(state => withActiveDraft(state, () => ({ document, contexts })), false, 'restoreDraft');
    },

    restoreDraftIfEmpty: (document, contexts) => {
      const state = get();
      const current = state.drafts[state.activeDraftKey] ?? emptyDraft();
      if (hasComposerContent(current.document) || current.contexts.length > 0) return false;
      set(currentState => withActiveDraft(
        currentState,
        () => ({ document, contexts }),
      ), false, 'restoreDraftIfEmpty');
      return true;
    },

    addContext: (item) => {
      set((state) => withActiveDraft(state, draft => {
        const existingIndex = draft.contexts.findIndex(context => context.id === item.id);
        if (existingIndex >= 0) {
          const contexts = [...draft.contexts];
          contexts[existingIndex] = item;
          return { ...draft, contexts };
        }
        return { ...draft, contexts: [...draft.contexts, item] };
      }), false, 'addContext');
    },

    removeContext: (id) => {
      set((state) => {
        const validationStates = new Map(state.validationStates);
        validationStates.delete(id);
        const validatingIds = new Set(state.validatingIds);
        validatingIds.delete(id);
        return {
          ...withActiveDraft(state, draft => ({
            contexts: draft.contexts.filter(context => context.id !== id),
            document: removeComposerContext(draft.document, id),
          })),
          validationStates,
          validatingIds,
        };
      }, false, 'removeContext');
    },

    clearContexts: () => {
      set(state => ({
        ...withActiveDraft(state, draft => ({
          contexts: [],
          document: {
            version: 1,
            nodes: draft.document.nodes.filter(node => node.type === 'text'),
          },
        })),
        validationStates: new Map(),
        validatingIds: new Set(),
      }), false, 'clearContexts');
    },

    clearDraft: () => {
      set(state => ({
        ...withActiveDraft(state, () => emptyDraft()),
        validationStates: new Map(),
        validatingIds: new Set(),
      }), false, 'clearDraft');
    },

    updateValidation: (id, result) => {
      set((state) => {
        const validationStates = new Map(state.validationStates);
        validationStates.set(id, result);
        const validatingIds = new Set(state.validatingIds);
        validatingIds.delete(id);
        return { validationStates, validatingIds };
      }, false, 'updateValidation');
    },

    setValidating: (id, validating) => {
      set((state) => {
        const validatingIds = new Set(state.validatingIds);
        if (validating) validatingIds.add(id);
        else validatingIds.delete(id);
        return { validatingIds };
      }, false, 'setValidating');
    },

    reorderContexts: (startIndex, endIndex) => {
      set(state => withActiveDraft(state, draft => {
        const contexts = [...draft.contexts];
        const [removed] = contexts.splice(startIndex, 1);
        if (!removed) return draft;
        contexts.splice(endIndex, 0, removed);
        return { ...draft, contexts };
      }), false, 'reorderContexts');
    },

    updateContext: (draftKey, id, updates) => {
      set(state => {
        const draft = state.drafts[draftKey] ?? emptyDraft();
        const contexts = draft.contexts.map(context => {
          if (context.id !== id) return context;
          const next = { ...context, ...updates } as ContextItem;
          if (next.type === 'text-fragment') {
            next.charCount = Array.from(next.content).length;
          }
          return next;
        });
        if (!contexts.some(context => context.id === id)) {
          log.warn('Cannot update missing Composer context', { id, draftKey });
        }
        const nextDraft = { ...draft, contexts };
        return {
          drafts: { ...state.drafts, [draftKey]: nextDraft },
          ...(state.activeDraftKey === draftKey ? { contexts } : {}),
        };
      }, false, 'updateContext');
    },
  }), {
    name: 'ComposerContextStore',
    enabled: process.env.NODE_ENV === 'development',
  }),
);

export const selectContexts = (state: ContextState) => state.contexts;
export const selectContextCount = (state: ContextState) => state.contexts.length;
export const selectContextById = (id: string) => (state: ContextState) =>
  state.contexts.find(context => context.id === id);
export const selectValidationState = (id: string) => (state: ContextState) =>
  state.validationStates.get(id);
export const selectIsValidating = (id: string) => (state: ContextState) =>
  state.validatingIds.has(id);
export const selectHasInvalidContexts = (state: ContextState) =>
  Array.from(state.validationStates.values()).some(result => !result.valid);
