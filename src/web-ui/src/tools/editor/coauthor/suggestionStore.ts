import { create } from 'zustand';
import type { DocumentEditProposal } from './protocol';

export type ProposalLifecycle = 'submitting' | 'streaming' | 'reviewing' | 'applied' | 'discarded' | 'failed' | 'stale';

export interface SuggestionEntry {
  proposal: DocumentEditProposal;
  status: ProposalLifecycle;
  acceptedOpIds: string[];
  rejectedOpIds: string[];
  staleOpIds: string[];
  error?: string;
  createdAt: number;
  updatedAt: number;
}

interface SuggestionStoreState {
  entries: Record<string, SuggestionEntry>;
  activeProposalId: string | null;
  upsertProposal: (proposal: DocumentEditProposal, status?: ProposalLifecycle) => void;
  setStatus: (proposalId: string, status: ProposalLifecycle, options?: { error?: string; staleOpIds?: string[] }) => void;
  acceptOps: (proposalId: string, opIds: string[]) => void;
  rejectOps: (proposalId: string, opIds: string[]) => void;
  discardProposal: (proposalId: string) => void;
  clearFile: (filePath?: string) => void;
}

export const useSuggestionStore = create<SuggestionStoreState>((set) => ({
  entries: {},
  activeProposalId: null,
  upsertProposal: (proposal, status = 'reviewing') => set((state) => {
    const previous = state.entries[proposal.proposalId];
    const now = Date.now();
    return {
      activeProposalId: proposal.proposalId,
      entries: {
        ...state.entries,
        [proposal.proposalId]: {
          proposal,
          status,
          acceptedOpIds: previous?.acceptedOpIds ?? [],
          rejectedOpIds: previous?.rejectedOpIds ?? [],
          staleOpIds: previous?.staleOpIds ?? [],
          error: previous?.error,
          createdAt: previous?.createdAt ?? now,
          updatedAt: now,
        },
      },
    };
  }),
  setStatus: (proposalId, status, options) => set((state) => {
    const entry = state.entries[proposalId];
    if (!entry) {
      return state;
    }
    return {
      entries: {
        ...state.entries,
        [proposalId]: {
          ...entry,
          status,
          error: options?.error,
          staleOpIds: options?.staleOpIds ?? entry.staleOpIds,
          updatedAt: Date.now(),
        },
      },
      activeProposalId: status === 'discarded' || status === 'applied' ? null : state.activeProposalId,
    };
  }),
  acceptOps: (proposalId, opIds) => set((state) => {
    const entry = state.entries[proposalId];
    if (!entry) {
      return state;
    }
    return {
      entries: {
        ...state.entries,
        [proposalId]: {
          ...entry,
          acceptedOpIds: Array.from(new Set([...entry.acceptedOpIds, ...opIds])),
          updatedAt: Date.now(),
        },
      },
    };
  }),
  rejectOps: (proposalId, opIds) => set((state) => {
    const entry = state.entries[proposalId];
    if (!entry) {
      return state;
    }
    return {
      entries: {
        ...state.entries,
        [proposalId]: {
          ...entry,
          rejectedOpIds: Array.from(new Set([...entry.rejectedOpIds, ...opIds])),
          updatedAt: Date.now(),
        },
      },
    };
  }),
  discardProposal: (proposalId) => set((state) => {
    const nextEntries = { ...state.entries };
    delete nextEntries[proposalId];
    return {
      entries: nextEntries,
      activeProposalId: state.activeProposalId === proposalId ? null : state.activeProposalId,
    };
  }),
  clearFile: (filePath) => set((state) => {
    if (!filePath) {
      return { entries: {}, activeProposalId: null };
    }
    const entries = Object.fromEntries(
      Object.entries(state.entries).filter(([, entry]) => entry.proposal.filePath !== filePath),
    );
    return {
      entries,
      activeProposalId: state.activeProposalId && entries[state.activeProposalId] ? state.activeProposalId : null,
    };
  }),
}));
