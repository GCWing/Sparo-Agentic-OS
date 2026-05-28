import { createLogger } from '@/shared/utils/logger';
import type { MarkdownAction, MarkdownActionContext, MarkdownEditProposal } from './protocol';
import { useSuggestionStore } from './suggestionStore';

export type ProposalSessionState = 'Idle' | 'Submitting' | 'Streaming' | 'Reviewing' | 'Applied' | 'Discarded' | 'Failed' | 'Stale';

const log = createLogger('CoauthorProposalSession');

export class ProposalSession {
  state: ProposalSessionState = 'Idle';

  async run(action: MarkdownAction, ctx: MarkdownActionContext): Promise<MarkdownEditProposal> {
    this.state = 'Submitting';
    let latest: MarkdownEditProposal | null = null;
    let streamedText = '';
    let streamedChunkCount = 0;
    const streamingProposalId = `proposal-stream-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    try {
      for await (const chunk of action.run(ctx)) {
        if (chunk.type === 'text') {
          streamedText += chunk.text;
          streamedChunkCount += 1;
          this.state = 'Streaming';
          const streamingProposal = buildStreamingSelectionProposal(ctx, streamedText, streamingProposalId);
          if (streamingProposal) {
            latest = streamingProposal;
            useSuggestionStore.getState().upsertProposal(streamingProposal, 'streaming');
            log.debug('Updated streaming Markdown proposal', {
              proposalId: streamingProposalId,
              actionId: ctx.actionId,
              chunkIndex: streamedChunkCount,
              streamedChars: streamedText.length,
            });
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
        if (isUnchangedSelectionRewrite(ctx, latest)) {
          this.state = 'Failed';
          useSuggestionStore.getState().discardProposal(streamingProposalId);
          log.warn('Discarded unchanged selection rewrite proposal', {
            proposalId: latest.proposalId,
            streamedChunkCount,
            streamedChars: streamedText.length,
            selectedChars: ctx.target.kind === 'selection' ? ctx.target.markdown.length : 0,
            outputChars: getSelectionRewriteMarkdown(latest)?.length ?? 0,
          });
          throw new Error('AI returned the selected text unchanged. Try a more specific instruction.');
        }
        this.state = 'Reviewing';
        if (latest.proposalId !== streamingProposalId) {
          useSuggestionStore.getState().discardProposal(streamingProposalId);
        }
        useSuggestionStore.getState().upsertProposal(latest, 'reviewing');
        log.debug('Updated reviewing Markdown proposal', {
          proposalId: latest.proposalId,
          actionId: ctx.actionId,
          streamedChunkCount,
          streamedChars: streamedText.length,
          opCount: latest.ops.length,
        });
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

function normalizeComparableMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .trim()
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

function getSelectionRewriteMarkdown(proposal: MarkdownEditProposal): string | null {
  const op = proposal.ops.find(item => item.id === 'op-rewrite-selection' && item.type === 'replaceRange');
  return op && op.type === 'replaceRange' ? op.markdown : null;
}

function isUnchangedSelectionRewrite(ctx: MarkdownActionContext, proposal: MarkdownEditProposal): boolean {
  if (ctx.actionId !== 'rewrite_selection' || ctx.target.kind !== 'selection') {
    return false;
  }

  const markdown = getSelectionRewriteMarkdown(proposal);
  if (markdown === null) {
    return false;
  }

  return normalizeComparableMarkdown(markdown) === normalizeComparableMarkdown(ctx.target.markdown);
}

function buildStreamingSelectionProposal(
  ctx: MarkdownActionContext,
  markdown: string,
  proposalId: string,
): MarkdownEditProposal | null {
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
