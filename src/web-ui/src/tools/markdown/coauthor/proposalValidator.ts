import type { MarkdownAction, MarkdownActionContext, MarkdownEditProposal } from './protocol';
import { parseMarkdownEditProposal } from './protocol';

export function parseAndValidateMarkdownProposal(
  value: unknown,
  action: MarkdownAction,
  ctx: MarkdownActionContext,
): MarkdownEditProposal {
  const proposal = parseMarkdownEditProposal(value);

  if (proposal.scope !== ctx.scope) {
    throw new Error(`Proposal scope mismatch: expected ${ctx.scope}, received ${proposal.scope}`);
  }

  if (proposal.intent !== ctx.intent) {
    throw new Error(`Proposal intent mismatch: expected ${ctx.intent}, received ${proposal.intent}`);
  }

  const allowedOps = new Set(action.contract.allowedOps);
  const invalidOp = proposal.ops.find(op => !allowedOps.has(op.type));
  if (invalidOp) {
    throw new Error(`Proposal operation ${invalidOp.type} is not allowed for ${action.id}`);
  }

  if (ctx.intent === 'review') {
    const editableOp = proposal.ops.find(op => op.type !== 'comment');
    if (editableOp) {
      throw new Error(`Review proposals may only return comments, received ${editableOp.type}`);
    }
  }

  if (ctx.target.kind !== 'document') {
    const documentOp = proposal.ops.find(op => op.type === 'replaceDocument');
    if (documentOp) {
      throw new Error(`Scoped Markdown action ${action.id} cannot replace the whole document`);
    }
  }

  return {
    ...proposal,
    sourceMarkdown: ctx.sourceMarkdown,
    sourceBlocks: ctx.sourceBlocks,
  };
}
