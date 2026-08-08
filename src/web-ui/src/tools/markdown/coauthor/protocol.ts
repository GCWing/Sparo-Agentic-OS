import type {
  DocPosition,
  MarkdownDocumentProfile,
  MarkdownEditOp,
  MarkdownEditProposal,
  MarkdownEditProposalChunk,
  MarkdownIntent,
  MarkdownScope,
  MarkdownSourceBlock,
  MarkdownTarget,
} from '@/shared/types/markdown-ai';
export type {
  DocPosition,
  MarkdownDocumentProfile,
  MarkdownEditOp,
  MarkdownEditProposal,
  MarkdownEditProposalChunk,
  MarkdownIntent,
  MarkdownScope,
  MarkdownSourceBlock,
  MarkdownTarget,
} from '@/shared/types/markdown-ai';

export interface MarkdownActionContext {
  requestId?: string;
  actionId: string;
  scope: MarkdownScope;
  intent: MarkdownIntent;
  filePath?: string;
  sourceHash: string;
  sourceMarkdown?: string;
  sourceBlocks?: MarkdownSourceBlock[];
  documentMarkdown: string;
  target: MarkdownTarget;
  profile?: MarkdownDocumentProfile;
  userDirective?: string;
  modelId?: string;
}

export type MarkdownEditOperationType = MarkdownEditOp['type'];
export type MarkdownContextPolicy = 'targetOnly' | 'nearby' | 'focusedDocument' | 'wholeDocument';

export interface MarkdownActionContract {
  allowedOps: MarkdownEditOperationType[];
  contextPolicy: MarkdownContextPolicy;
  instruction: string;
  constraints: string[];
}

export interface MarkdownAction {
  id: string;
  title: string;
  group?: string;
  icon?: string;
  targets: MarkdownScope[];
  modes: MarkdownIntent[];
  contract: MarkdownActionContract;
  inputSchema?: unknown;
  shortcut?: string;
  showWhen?: (ctx: MarkdownActionContext) => boolean;
  run(ctx: MarkdownActionContext): AsyncIterable<MarkdownEditProposalChunk>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parsePosition(value: unknown): DocPosition | null {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return null;
  }

  if (value.kind === 'blockId' && typeof value.blockId === 'string') {
    return {
      kind: 'blockId',
      blockId: value.blockId,
      offset: typeof value.offset === 'number' ? value.offset : undefined,
    };
  }

  if (value.kind === 'markdownOffset' && typeof value.offset === 'number') {
    return { kind: 'markdownOffset', offset: value.offset };
  }

  if (value.kind === 'lineCol' && typeof value.line === 'number' && typeof value.column === 'number') {
    return { kind: 'lineCol', line: value.line, column: value.column };
  }

  return null;
}

function parseOp(value: unknown): MarkdownEditOp | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.type !== 'string') {
    return null;
  }

  if (value.type === 'replaceDocument' && typeof value.markdown === 'string') {
    return {
      id: value.id,
      type: 'replaceDocument',
      markdown: value.markdown,
      summary: typeof value.summary === 'string' ? value.summary : undefined,
    };
  }

  if (value.type === 'insertAt' && typeof value.markdown === 'string') {
    const position = parsePosition(value.position);
    if (!position) {
      return null;
    }
    return {
      id: value.id,
      type: 'insertAt',
      position,
      markdown: value.markdown,
      reason: typeof value.reason === 'string' ? value.reason : undefined,
    };
  }

  if (value.type === 'replaceRange' && typeof value.markdown === 'string') {
    const from = parsePosition(value.from);
    const to = parsePosition(value.to);
    if (!from || !to) {
      return null;
    }
    return {
      id: value.id,
      type: 'replaceRange',
      from,
      to,
      markdown: value.markdown,
      reason: typeof value.reason === 'string' ? value.reason : undefined,
    };
  }

  if (value.type === 'deleteRange') {
    const from = parsePosition(value.from);
    const to = parsePosition(value.to);
    if (!from || !to) {
      return null;
    }
    return {
      id: value.id,
      type: 'deleteRange',
      from,
      to,
      reason: typeof value.reason === 'string' ? value.reason : undefined,
    };
  }

  if (value.type === 'comment' && typeof value.message === 'string') {
    const from = parsePosition(value.from);
    const to = parsePosition(value.to);
    if (!from || !to) {
      return null;
    }
    const severity = value.severity === 'warning' || value.severity === 'error' ? value.severity : 'info';
    return { id: value.id, type: 'comment', from, to, message: value.message, severity };
  }

  return null;
}

export function parseMarkdownEditProposal(value: unknown): MarkdownEditProposal {
  if (!isRecord(value)) {
    throw new Error('Proposal must be an object');
  }

  const scope = value.scope === 'selection' || value.scope === 'block' || value.scope === 'document'
    ? value.scope
    : null;
  const intent = value.intent === 'apply' || value.intent === 'review' ? value.intent : null;
  const ops = Array.isArray(value.ops) ? value.ops.map(parseOp).filter((op): op is MarkdownEditOp => !!op) : [];

  if (
    typeof value.proposalId !== 'string' ||
    typeof value.sourceHash !== 'string' ||
    !scope ||
    !intent ||
    ops.length === 0
  ) {
    throw new Error('Proposal is missing required fields');
  }

  return {
    proposalId: value.proposalId,
    filePath: typeof value.filePath === 'string' ? value.filePath : undefined,
    sourceHash: value.sourceHash,
    scope,
    intent,
    ops,
    summary: typeof value.summary === 'string' ? value.summary : undefined,
    modelId: typeof value.modelId === 'string' ? value.modelId : undefined,
    finishReason: typeof value.finishReason === 'string' ? value.finishReason : undefined,
  };
}

export function extractProposalFromText(text: string): MarkdownEditProposal {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  return parseMarkdownEditProposal(JSON.parse(candidate));
}
