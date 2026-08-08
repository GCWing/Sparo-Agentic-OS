export type MarkdownScope = 'selection' | 'block' | 'document';
export type MarkdownIntent = 'apply' | 'review';

export type DocPosition =
  | { kind: 'blockId'; blockId: string; offset?: number }
  | { kind: 'markdownOffset'; offset: number }
  | { kind: 'lineCol'; line: number; column: number };

export type MarkdownEditOp =
  | { id: string; type: 'replaceRange'; from: DocPosition; to: DocPosition; markdown: string; reason?: string }
  | { id: string; type: 'insertAt'; position: DocPosition; markdown: string; reason?: string }
  | { id: string; type: 'deleteRange'; from: DocPosition; to: DocPosition; reason?: string }
  | { id: string; type: 'comment'; from: DocPosition; to: DocPosition; message: string; severity?: 'info' | 'warning' | 'error' }
  | { id: string; type: 'replaceDocument'; markdown: string; summary?: string };

export interface MarkdownSourceBlock {
  blockId?: string;
  markdown: string;
}

export interface MarkdownEditProposal {
  proposalId: string;
  filePath?: string;
  sourceHash: string;
  sourceMarkdown?: string;
  sourceBlocks?: MarkdownSourceBlock[];
  scope: MarkdownScope;
  intent: MarkdownIntent;
  ops: MarkdownEditOp[];
  summary?: string;
  modelId?: string;
  finishReason?: string;
}

export interface MarkdownDocumentProfile {
  purpose?: string;
  audience?: string;
  tone?: string;
  length?: string;
  forbiddenWords?: string[];
  language?: string;
}

export type MarkdownTarget =
  | { kind: 'selection'; from: DocPosition; to: DocPosition; markdown: string }
  | { kind: 'block'; blockId?: string; from: DocPosition; to: DocPosition; markdown: string }
  | { kind: 'document' };

export type MarkdownEditProposalChunk =
  | { type: 'proposal'; proposal: MarkdownEditProposal }
  | { type: 'text'; text: string }
  | { type: 'error'; error: string };
