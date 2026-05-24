import type { DocumentAction, DocumentActionContext, DocumentEditProposal } from './protocol';
import { useSuggestionStore } from './suggestionStore';

export type ProposalSessionState = 'Idle' | 'Submitting' | 'Streaming' | 'Reviewing' | 'Applied' | 'Discarded' | 'Failed' | 'Stale';

export class ProposalSession {
  state: ProposalSessionState = 'Idle';

  async run(action: DocumentAction, ctx: DocumentActionContext): Promise<DocumentEditProposal> {
    this.state = 'Submitting';
    let latest: DocumentEditProposal | null = null;
    let streamedText = '';
    const streamingProposalId = `proposal-stream-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    try {
      for await (const chunk of action.run(ctx)) {
        if (chunk.type === 'text') {
          streamedText += chunk.text;
          this.state = 'Streaming';
          const streamingProposal = buildStreamingSelectionProposal(ctx, streamedText, streamingProposalId);
          if (streamingProposal) {
            latest = streamingProposal;
            useSuggestionStore.getState().upsertProposal(streamingProposal, 'streaming');
          }
          continue;
        }
        if (chunk.type === 'error') {
          this.state = 'Failed';
          throw new Error(chunk.error);
        }
        latest = {
          ...chunk.proposal,
          sourceMarkdown: ctx.sourceMarkdown,
          sourceBlocks: ctx.sourceBlocks,
        };
        this.state = 'Reviewing';
        if (latest.proposalId !== streamingProposalId) {
          useSuggestionStore.getState().discardProposal(streamingProposalId);
        }
        useSuggestionStore.getState().upsertProposal(latest, 'reviewing');
      }
    } catch (error) {
      this.state = 'Failed';
      throw error;
    }

    if (!latest) {
      this.state = 'Failed';
      throw new Error('AI did not return a proposal');
    }

    return latest;
  }
}

function buildStreamingSelectionProposal(
  ctx: DocumentActionContext,
  markdown: string,
  proposalId: string,
): DocumentEditProposal | null {
  if (ctx.actionId !== 'rewrite_selection' || ctx.target.kind !== 'selection' || !markdown.trim()) {
    return null;
  }

  return {
    proposalId,
    filePath: ctx.filePath,
    sourceHash: ctx.sourceHash,
    sourceMarkdown: ctx.sourceMarkdown,
    sourceBlocks: ctx.sourceBlocks,
    scope: 'selection',
    intent: 'apply',
    summary: 'Selection rewrite',
    ops: [{
      id: 'op-rewrite-selection',
      type: 'replaceRange',
      from: ctx.target.from,
      to: ctx.target.to,
      markdown,
      reason: ctx.userDirective,
    }],
  };
}
