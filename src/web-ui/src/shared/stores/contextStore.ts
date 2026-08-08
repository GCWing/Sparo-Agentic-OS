import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  ComposerDocument,
  ContextReference,
} from '../types/composer';
import {
  createContextReference,
  createComposerTextDocument,
  EMPTY_COMPOSER_DOCUMENT,
  hasComposerContent,
  removeComposerContext,
} from '../types/composer';
import type { ContextItem, ValidationResult } from '../types/context';
import { createLogger } from '@/shared/utils/logger';
import {
  attachmentIdentityKey,
  attachmentsAreEquivalent,
  buildAttachmentIdentityIndex,
} from '@/shared/context-system/attachmentIdentity';
import { releaseImageAsset } from '@/shared/media/imageAssetStore';

const log = createLogger('ComposerContextStore');
const DEFAULT_DRAFT_KEY = 'composer:unbound';

interface ComposerDraft {
  document: ComposerDocument;
  assets: ContextItem[];
  references: ContextReference[];
  identityIndex: Record<string, string[]>;
}

export interface AttachmentResolveOptions {
  maxAssetsOfType?: number;
}

export type AttachmentResolution =
  | { kind: 'created' | 'reused'; asset: ContextItem }
  | { kind: 'rejected'; reason: 'type-limit' };

export type AttachmentReferenceResolution =
  | { kind: 'created' | 'reused'; asset: ContextItem; reference: ContextReference }
  | { kind: 'rejected'; reason: 'type-limit' };

export interface AttachmentActivity {
  assetId: string;
  draftKey: string;
  kind: 'reused';
  sequence: number;
}

interface ContextState {
  activeDraftKey: string;
  drafts: Record<string, ComposerDraft>;
  assets: ContextItem[];
  references: ContextReference[];
  document: ComposerDocument;
  validationStates: Map<string, ValidationResult>;
  validatingIds: Set<string>;
  attachmentActivity: AttachmentActivity | null;
  setActiveDraft: (draftKey: string) => void;
  setDocument: (document: ComposerDocument) => void;
  replaceDraftText: (text: string) => void;
  restoreDraft: (
    document: ComposerDocument,
    assets: ContextItem[],
    references: ContextReference[],
  ) => void;
  restoreDraftIfEmpty: (
    document: ComposerDocument,
    assets: ContextItem[],
    references: ContextReference[],
  ) => boolean;
  addAttachment: (item: ContextItem) => void;
  addAttachmentReference: (item: ContextItem) => ContextReference;
  resolveAttachment: (
    item: ContextItem,
    options?: AttachmentResolveOptions,
  ) => AttachmentResolution;
  resolveAttachmentReference: (
    item: ContextItem,
    options?: AttachmentResolveOptions,
  ) => AttachmentReferenceResolution;
  createAttachmentReference: (assetId: string) => ContextReference | null;
  removeAttachment: (assetId: string) => void;
  removeReference: (id: string) => void;
  clearContexts: () => void;
  clearDraft: () => void;
  updateValidation: (id: string, result: ValidationResult) => void;
  setValidating: (id: string, validating: boolean) => void;
  reorderContexts: (startIndex: number, endIndex: number) => void;
  updateContext: (draftKey: string, id: string, updates: Partial<ContextItem>) => void;
}

function emptyDraft(): ComposerDraft {
  return {
    document: { version: 2, nodes: [] },
    assets: [],
    references: [],
    identityIndex: {},
  };
}

function normalizeDraft(draft: Omit<ComposerDraft, 'identityIndex'> & {
  identityIndex?: Record<string, string[]>;
}): ComposerDraft {
  return {
    ...draft,
    identityIndex: draft.identityIndex || buildAttachmentIdentityIndex(draft.assets),
  };
}

/**
 * Old snapshots may predate asset reuse and therefore contain the same asset
 * more than once. Collapse those assets as they enter the live draft and
 * rewire every positional reference to the first canonical asset.
 */
function reconcileRestoredDraft(
  document: ComposerDocument,
  assets: ContextItem[],
  references: ContextReference[],
): ComposerDraft {
  const canonicalAssets: ContextItem[] = [];
  const canonicalIds = new Map<string, string>();
  const identityIndex: Record<string, string[]> = {};

  assets.forEach(asset => {
    const sameId = canonicalAssets.find(candidate => candidate.id === asset.id);
    const key = attachmentIdentityKey(asset);
    const equivalent = sameId || (key
      ? (identityIndex[key] || [])
          .map(id => canonicalAssets.find(candidate => candidate.id === id))
          .find((candidate): candidate is ContextItem => (
            Boolean(candidate && attachmentsAreEquivalent(candidate, asset))
          ))
      : undefined);

    if (equivalent) {
      canonicalIds.set(asset.id, equivalent.id);
      return;
    }

    canonicalAssets.push(asset);
    canonicalIds.set(asset.id, asset.id);
    if (key) (identityIndex[key] ||= []).push(asset.id);
  });

  return {
    document,
    assets: canonicalAssets,
    references: references.map(reference => {
      const canonicalId = canonicalIds.get(reference.assetId);
      return canonicalId && canonicalId !== reference.assetId
        ? { ...reference, assetId: canonicalId }
        : reference;
    }),
    identityIndex,
  };
}

function disposeUncommittedAttachment(item: ContextItem): void {
  if (item.type === 'image' && item.sourceRef.kind === 'memory-asset') {
    releaseImageAsset(item.sourceRef);
  }
}

function withActiveDraft(
  state: ContextState,
  update: (draft: ComposerDraft) => ComposerDraft,
): Partial<ContextState> {
  const current = state.drafts[state.activeDraftKey] ?? emptyDraft();
  const updated = update(normalizeDraft(current));
  const next = {
    ...updated,
    identityIndex: buildAttachmentIdentityIndex(updated.assets),
  };
  return {
    drafts: { ...state.drafts, [state.activeDraftKey]: next },
    document: next.document,
    assets: next.assets,
    references: next.references,
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
    assets: [],
    references: [],
    document: EMPTY_COMPOSER_DOCUMENT,
    validationStates: new Map(),
    validatingIds: new Set(),
    attachmentActivity: null,

    setActiveDraft: (draftKey) => {
      const normalizedKey = draftKey.trim() || DEFAULT_DRAFT_KEY;
      set((state) => {
        if (state.activeDraftKey === normalizedKey) return state;
        const draft = normalizeDraft(state.drafts[normalizedKey] ?? emptyDraft());
        return {
          activeDraftKey: normalizedKey,
          document: draft.document,
          assets: draft.assets,
          references: draft.references,
          validationStates: new Map(),
          validatingIds: new Set(),
          attachmentActivity: null,
        };
      }, false, 'setActiveDraft');
    },

    setDocument: (document) => {
      set(state => withActiveDraft(state, draft => ({ ...draft, document })), false, 'setDocument');
    },

    replaceDraftText: (text) => {
      set(state => withActiveDraft(state, draft => {
        return {
          ...draft,
          document: createComposerTextDocument(text),
          references: [],
        };
      }), false, 'replaceDraftText');
    },

    restoreDraft: (document, assets, references) => {
      set(state => withActiveDraft(
        state,
        () => reconcileRestoredDraft(document, assets, references),
      ), false, 'restoreDraft');
    },

    restoreDraftIfEmpty: (document, assets, references) => {
      const state = get();
      const current = state.drafts[state.activeDraftKey] ?? emptyDraft();
      if (hasComposerContent(current.document) || current.assets.length > 0) return false;
      set(currentState => withActiveDraft(
        currentState,
        () => reconcileRestoredDraft(document, assets, references),
      ), false, 'restoreDraftIfEmpty');
      return true;
    },

    resolveAttachment: (item, options) => {
      const state = get();
      const draft = normalizeDraft(state.drafts[state.activeDraftKey] ?? emptyDraft());
      const sameId = draft.assets.find(asset => asset.id === item.id);
      const identityKey = attachmentIdentityKey(item);
      const matchingAsset = sameId || (identityKey
        ? (draft.identityIndex[identityKey] || [])
            .map(id => draft.assets.find(asset => asset.id === id))
            .find((asset): asset is ContextItem => Boolean(asset && attachmentsAreEquivalent(asset, item)))
        : undefined);

      if (matchingAsset) {
        if (matchingAsset.id !== item.id) disposeUncommittedAttachment(item);
        set({
          attachmentActivity: {
            assetId: matchingAsset.id,
            draftKey: state.activeDraftKey,
            kind: 'reused',
            sequence: (state.attachmentActivity?.sequence || 0) + 1,
          },
        }, false, 'reuseAttachment');
        return { kind: 'reused', asset: matchingAsset };
      }

      if (
        options?.maxAssetsOfType !== undefined
        && draft.assets.filter(asset => asset.type === item.type).length >= options.maxAssetsOfType
      ) {
        disposeUncommittedAttachment(item);
        return { kind: 'rejected', reason: 'type-limit' };
      }

      set(current => withActiveDraft(current, currentDraft => ({
        ...currentDraft,
        assets: [...currentDraft.assets, item],
      })), false, 'resolveAttachment');
      return { kind: 'created', asset: item };
    },

    resolveAttachmentReference: (item, options) => {
      const resolution = get().resolveAttachment(item, options);
      if (resolution.kind === 'rejected') return resolution;
      const reference = createContextReference(resolution.asset.id, 'inline');
      set(state => withActiveDraft(state, draft => ({
        ...draft,
        references: [...draft.references, reference],
      })), false, 'resolveAttachmentReference');
      return { ...resolution, reference };
    },

    addAttachment: (item) => {
      get().resolveAttachment(item);
    },

    addAttachmentReference: (item) => {
      const resolution = get().resolveAttachmentReference(item);
      if (resolution.kind === 'rejected') {
        throw new Error('Attachment was rejected by the Composer store');
      }
      return resolution.reference;
    },

    createAttachmentReference: (assetId) => {
      const state = get();
      const draft = state.drafts[state.activeDraftKey] ?? emptyDraft();
      if (!draft.assets.some(asset => asset.id === assetId)) {
        log.warn('Cannot reference missing Composer attachment', { assetId });
        return null;
      }
      const reference = createContextReference(assetId, 'inline');
      set(current => withActiveDraft(current, activeDraft => ({
        ...activeDraft,
        references: [...activeDraft.references, reference],
      })), false, 'createAttachmentReference');
      return reference;
    },

    removeAttachment: (assetId) => {
      set((state) => {
        const draft = state.drafts[state.activeDraftKey] ?? emptyDraft();
        const removedReferenceIds = new Set(
          draft.references
            .filter(reference => reference.assetId === assetId)
            .map(reference => reference.id),
        );
        const validationStates = new Map(state.validationStates);
        const validatingIds = new Set(state.validatingIds);
        validationStates.delete(assetId);
        validatingIds.delete(assetId);
        removedReferenceIds.forEach(referenceId => {
          validationStates.delete(referenceId);
          validatingIds.delete(referenceId);
        });
        return {
          ...withActiveDraft(state, currentDraft => ({
            ...currentDraft,
            assets: currentDraft.assets.filter(asset => asset.id !== assetId),
            references: currentDraft.references.filter(reference => reference.assetId !== assetId),
            document: removedReferenceIds.size === 0
              ? currentDraft.document
              : Array.from(removedReferenceIds).reduce(
                  (document, referenceId) => removeComposerContext(document, referenceId),
                  currentDraft.document,
                ),
          })),
          validationStates,
          validatingIds,
          attachmentActivity: state.attachmentActivity?.assetId === assetId
            ? null
            : state.attachmentActivity,
        };
      }, false, 'removeAttachment');
    },

    removeReference: (id) => {
      set((state) => {
        const validationStates = new Map(state.validationStates);
        validationStates.delete(id);
        const validatingIds = new Set(state.validatingIds);
        validatingIds.delete(id);
        return {
          ...withActiveDraft(state, draft => {
            const references = draft.references.filter(reference => reference.id !== id);
            return {
              ...draft,
              references,
              document: removeComposerContext(draft.document, id),
            };
          }),
          validationStates,
          validatingIds,
        };
      }, false, 'removeReference');
    },

    clearContexts: () => {
      set(state => ({
        ...withActiveDraft(state, draft => ({
          ...draft,
          assets: [],
          references: [],
          document: {
            version: 2,
            nodes: draft.document.nodes.filter(node => node.type === 'text'),
          },
        })),
        validationStates: new Map(),
        validatingIds: new Set(),
        attachmentActivity: null,
      }), false, 'clearContexts');
    },

    clearDraft: () => {
      set(state => ({
        ...withActiveDraft(state, () => emptyDraft()),
        validationStates: new Map(),
        validatingIds: new Set(),
        attachmentActivity: null,
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
        const assets = [...draft.assets];
        const [removed] = assets.splice(startIndex, 1);
        if (!removed) return draft;
        assets.splice(endIndex, 0, removed);
        return { ...draft, assets };
      }), false, 'reorderContexts');
    },

    updateContext: (draftKey, id, updates) => {
      set(state => {
        const draft = state.drafts[draftKey] ?? emptyDraft();
        const assets = draft.assets.map(context => {
          if (context.id !== id) return context;
          const next = { ...context, ...updates } as ContextItem;
          if (next.type === 'text-fragment') {
            next.charCount = Array.from(next.content).length;
          }
          return next;
        });
        if (!assets.some(context => context.id === id)) {
          log.warn('Cannot update missing Composer context', { id, draftKey });
        }
        const nextDraft = {
          ...draft,
          assets,
          identityIndex: buildAttachmentIdentityIndex(assets),
        };
        return {
          drafts: { ...state.drafts, [draftKey]: nextDraft },
          ...(state.activeDraftKey === draftKey ? { assets } : {}),
        };
      }, false, 'updateContext');
    },
  }), {
    name: 'ComposerContextStore',
    enabled: process.env.NODE_ENV === 'development',
  }),
);

export const selectContexts = (state: ContextState) => state.assets;
export const selectContextCount = (state: ContextState) => state.assets.length;
export const selectContextById = (id: string) => (state: ContextState) =>
  state.assets.find(context => context.id === id);
export const selectValidationState = (id: string) => (state: ContextState) =>
  state.validationStates.get(id);
export const selectIsValidating = (id: string) => (state: ContextState) =>
  state.validatingIds.has(id);
export const selectHasInvalidContexts = (state: ContextState) =>
  Array.from(state.validationStates.values()).some(result => !result.valid);
