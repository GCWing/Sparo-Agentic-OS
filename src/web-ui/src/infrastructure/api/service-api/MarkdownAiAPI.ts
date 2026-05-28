import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';
import type {
  MarkdownEditProposal,
  MarkdownEditProposalChunk,
  MarkdownIntent,
  MarkdownDocumentProfile,
  MarkdownScope,
  MarkdownTarget,
} from '@/tools/markdown/coauthor/protocol';

export interface MarkdownAiResponse {
  ok: boolean;
}

export interface MarkdownAiCancelRequest {
  requestId: string;
}

export interface MarkdownAiProposeEditsRequest {
  requestId: string;
  actionId: string;
  scope: MarkdownScope;
  intent: MarkdownIntent;
  filePath?: string;
  sourceHash: string;
  documentMarkdown: string;
  target: MarkdownTarget;
  profile?: MarkdownDocumentProfile;
  userDirective?: string;
  modelId?: string;
}

export interface MarkdownAiErrorEvent {
  requestId: string;
  error: string;
}

export interface MarkdownAiProposalChunkEvent {
  requestId: string;
  chunk: MarkdownEditProposalChunk;
}

export interface MarkdownAiProposalCompletedEvent {
  requestId: string;
  proposal: MarkdownEditProposal;
  finishReason?: string | null;
}

export class MarkdownAiAPI {
  async cancel(request: MarkdownAiCancelRequest): Promise<void> {
    try {
      await api.invoke<void>('markdown_ai_cancel', { request });
    } catch (error) {
      throw createTauriCommandError('markdown_ai_cancel', error, request);
    }
  }

  async proposeEdits(request: MarkdownAiProposeEditsRequest): Promise<MarkdownAiResponse> {
    try {
      return await api.invoke<MarkdownAiResponse>('markdown_ai_propose_edits', { request });
    } catch (error) {
      throw createTauriCommandError('markdown_ai_propose_edits', error, {
        ...request,
        documentMarkdown: '[redacted]',
        profile: request.profile ? '[redacted]' : undefined,
      });
    }
  }

  onError(callback: (event: MarkdownAiErrorEvent) => void): () => void {
    return api.listen<MarkdownAiErrorEvent>('markdown-ai://error', callback);
  }

  onProposalChunk(callback: (event: MarkdownAiProposalChunkEvent) => void): () => void {
    return api.listen<MarkdownAiProposalChunkEvent>('markdown-ai://proposal-chunk', callback);
  }

  onProposalChunkReady(callback: (event: MarkdownAiProposalChunkEvent) => void): Promise<() => void> {
    return api.listenReady<MarkdownAiProposalChunkEvent>('markdown-ai://proposal-chunk', callback);
  }

  onProposalCompleted(callback: (event: MarkdownAiProposalCompletedEvent) => void): () => void {
    return api.listen<MarkdownAiProposalCompletedEvent>('markdown-ai://proposal-completed', callback);
  }

  onProposalCompletedReady(callback: (event: MarkdownAiProposalCompletedEvent) => void): Promise<() => void> {
    return api.listenReady<MarkdownAiProposalCompletedEvent>('markdown-ai://proposal-completed', callback);
  }

  onErrorReady(callback: (event: MarkdownAiErrorEvent) => void): Promise<() => void> {
    return api.listenReady<MarkdownAiErrorEvent>('markdown-ai://error', callback);
  }
}

export const markdownAiAPI = new MarkdownAiAPI();
