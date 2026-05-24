import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';
import type {
  DocumentEditProposal,
  DocumentEditProposalChunk,
  DocumentIntent,
  DocumentProfile,
  DocumentScope,
  DocumentTarget,
} from '@/tools/editor/coauthor/protocol';

export interface EditorAiStreamRequest {
  requestId: string;
  prompt: string;
  modelId?: string;
}

export interface EditorAiStreamResponse {
  ok: boolean;
}

export interface EditorAiCancelRequest {
  requestId: string;
}

export interface EditorAiProposeEditsRequest {
  requestId: string;
  actionId: string;
  scope: DocumentScope;
  intent: DocumentIntent;
  filePath?: string;
  sourceHash: string;
  documentMarkdown: string;
  target: DocumentTarget;
  profile?: DocumentProfile;
  userDirective?: string;
  modelId?: string;
}

export interface EditorAiTextChunkEvent {
  requestId: string;
  text: string;
}

export interface EditorAiCompletedEvent {
  requestId: string;
  fullText: string;
  finishReason?: string | null;
}

export interface EditorAiErrorEvent {
  requestId: string;
  error: string;
}

export interface EditorAiProposalChunkEvent {
  requestId: string;
  chunk: DocumentEditProposalChunk;
}

export interface EditorAiProposalCompletedEvent {
  requestId: string;
  proposal: DocumentEditProposal;
  finishReason?: string | null;
}

export class EditorAiAPI {
  async stream(request: EditorAiStreamRequest): Promise<EditorAiStreamResponse> {
    try {
      return await api.invoke<EditorAiStreamResponse>('editor_ai_stream', { request });
    } catch (error) {
      throw createTauriCommandError('editor_ai_stream', error, request);
    }
  }

  async cancel(request: EditorAiCancelRequest): Promise<void> {
    try {
      await api.invoke<void>('editor_ai_cancel', { request });
    } catch (error) {
      throw createTauriCommandError('editor_ai_cancel', error, request);
    }
  }

  async proposeEdits(request: EditorAiProposeEditsRequest): Promise<EditorAiStreamResponse> {
    try {
      return await api.invoke<EditorAiStreamResponse>('editor_ai_propose_edits', { request });
    } catch (error) {
      throw createTauriCommandError('editor_ai_propose_edits', error, {
        ...request,
        documentMarkdown: '[redacted]',
        profile: request.profile ? '[redacted]' : undefined,
      });
    }
  }

  onTextChunk(callback: (event: EditorAiTextChunkEvent) => void): () => void {
    return api.listen<EditorAiTextChunkEvent>('editor-ai://text-chunk', callback);
  }

  onCompleted(callback: (event: EditorAiCompletedEvent) => void): () => void {
    return api.listen<EditorAiCompletedEvent>('editor-ai://completed', callback);
  }

  onError(callback: (event: EditorAiErrorEvent) => void): () => void {
    return api.listen<EditorAiErrorEvent>('editor-ai://error', callback);
  }

  onProposalChunk(callback: (event: EditorAiProposalChunkEvent) => void): () => void {
    return api.listen<EditorAiProposalChunkEvent>('editor-ai://proposal-chunk', callback);
  }

  onProposalCompleted(callback: (event: EditorAiProposalCompletedEvent) => void): () => void {
    return api.listen<EditorAiProposalCompletedEvent>('editor-ai://proposal-completed', callback);
  }
}

export const editorAiAPI = new EditorAiAPI();
