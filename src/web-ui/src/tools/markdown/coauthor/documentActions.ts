import { markdownAiAPI } from '@/infrastructure/api/service-api/MarkdownAiAPI';
import { createLogger } from '@/shared/utils/logger';
import type {
  MarkdownAction,
  MarkdownActionContract,
  MarkdownActionContext,
  MarkdownEditProposalChunk,
} from './protocol';
import { parseAndValidateMarkdownProposal } from './proposalValidator';

const REQUEST_TIMEOUT_MS = 90_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 12;
const requestStarts: number[] = [];
const log = createLogger('CoauthorMarkdownActions');

function checkRateLimit(): boolean {
  const now = Date.now();
  while (requestStarts.length > 0 && requestStarts[0] < now - RATE_LIMIT_WINDOW_MS) {
    requestStarts.shift();
  }
  if (requestStarts.length >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  requestStarts.push(now);
  return true;
}

async function* runBackendProposal(
  action: MarkdownAction,
  ctx: MarkdownActionContext,
): AsyncIterable<MarkdownEditProposalChunk> {
  if (!checkRateLimit()) {
    yield { type: 'error', error: 'Too many co-author requests. Please pause briefly and try again.' };
    return;
  }

  const requestId = ctx.requestId ?? `markdown-coauthor-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  let cleanupChunk: () => void = () => {};
  let cleanupComplete: () => void = () => {};
  let cleanupError: () => void = () => {};
  let timeoutId: number | null = null;

  const queue: MarkdownEditProposalChunk[] = [];
  let done = false;
  let wakeWaiting: (() => void) | null = null;
  let receivedTextChunks = 0;
  let receivedTextChars = 0;

  const wake = () => {
    wakeWaiting?.();
    wakeWaiting = null;
  };

  cleanupChunk = await markdownAiAPI.onProposalChunkReady((event) => {
    if (event.requestId !== requestId) {
      return;
    }
    if (event.chunk.type === 'text') {
      receivedTextChunks += 1;
      receivedTextChars += event.chunk.text.length;
      log.debug('Received Markdown proposal text chunk', {
        requestId,
        chunkIndex: receivedTextChunks,
        chunkChars: event.chunk.text.length,
        receivedTextChars,
      });
    }
    queue.push(event.chunk);
    wake();
  });
  cleanupComplete = await markdownAiAPI.onProposalCompletedReady((event) => {
    if (event.requestId !== requestId) {
      return;
    }
    let proposal;
    try {
      proposal = parseAndValidateMarkdownProposal(event.proposal, action, ctx);
    } catch (error) {
      log.warn('Rejected invalid Markdown proposal', { requestId, actionId: action.id, error });
      queue.push({
        type: 'error',
        error: error instanceof Error ? error.message : 'Invalid Markdown proposal',
      });
      done = true;
      wake();
      return;
    }
    log.debug('Received Markdown proposal completion', {
      requestId,
      receivedTextChunks,
      receivedTextChars,
      opCount: proposal.ops.length,
    });
    queue.push({ type: 'proposal', proposal });
    done = true;
    wake();
  });
  cleanupError = await markdownAiAPI.onErrorReady((event) => {
    if (event.requestId !== requestId) {
      return;
    }
    log.warn('Received Markdown proposal error', { requestId, error: event.error });
    queue.push({ type: 'error', error: event.error });
    done = true;
    wake();
  });
  timeoutId = window.setTimeout(() => {
    if (done) {
      return;
    }
    done = true;
    queue.push({ type: 'error', error: 'Co-author request timed out.' });
    void markdownAiAPI.cancel({ requestId });
    wake();
  }, REQUEST_TIMEOUT_MS);

  try {
    await markdownAiAPI.proposeEdits({
      requestId,
      actionId: ctx.actionId,
      scope: ctx.scope,
      intent: ctx.intent,
      filePath: ctx.filePath,
      sourceHash: ctx.sourceHash,
      documentMarkdown: ctx.documentMarkdown,
      target: ctx.target,
      profile: ctx.profile,
      userDirective: ctx.userDirective,
      modelId: ctx.modelId,
    });

    while (!done || queue.length > 0) {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next) {
          yield next;
        }
      }
      if (!done) {
        await new Promise<void>(resolve => {
          wakeWaiting = resolve;
        });
      }
    }
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
    cleanupChunk();
    cleanupComplete();
    cleanupError();
  }
}

const action = (
  id: string,
  title: string,
  targets: MarkdownAction['targets'],
  contract: MarkdownActionContract,
  modes: MarkdownAction['modes'] = ['apply'],
  group = 'Co-author',
): MarkdownAction => {
  const markdownAction: MarkdownAction = {
    id,
    title,
    group,
    targets,
    modes,
    contract,
    run: (ctx) => runBackendProposal(markdownAction, ctx),
  };
  return markdownAction;
};

export const builtInMarkdownActions: MarkdownAction[] = [
  action('rewrite_selection', 'Rewrite selection', ['selection'], {
    allowedOps: ['replaceRange'],
    contextPolicy: 'nearby',
    instruction: 'Rewrite only the selected Markdown range according to the user directive.',
    constraints: ['Return replacement Markdown for the selected range only.', 'Preserve Markdown structure and inline syntax unless the user asks otherwise.'],
  }),
  action('continuation', 'Continue writing', ['block', 'document'], {
    allowedOps: ['insertAt', 'replaceRange'],
    contextPolicy: 'focusedDocument',
    instruction: 'Continue the Markdown document at the current insertion point.',
    constraints: ['Generate new content only.', 'Do not rewrite surrounding content.', 'Prefer concise continuation unless asked for more.'],
  }),
  action('summary', 'Summarize', ['selection', 'block', 'document'], {
    allowedOps: ['replaceRange', 'insertAt', 'replaceDocument'],
    contextPolicy: 'focusedDocument',
    instruction: 'Summarize the target Markdown clearly for the active audience.',
    constraints: ['Keep Markdown valid.', 'Do not invent facts beyond the supplied context.'],
  }),
  action('todo_extraction', 'Extract todos', ['selection', 'block', 'document'], {
    allowedOps: ['replaceRange', 'insertAt'],
    contextPolicy: 'focusedDocument',
    instruction: 'Extract concrete next actions from the target Markdown.',
    constraints: ['Prefer Markdown task list items.', 'Keep each item actionable.'],
  }),
  action('polish', 'Polish', ['selection', 'block', 'document'], {
    allowedOps: ['replaceRange', 'replaceDocument'],
    contextPolicy: 'focusedDocument',
    instruction: 'Improve clarity, flow, and wording while preserving meaning.',
    constraints: ['Do not add new claims.', 'Preserve Markdown structure where practical.'],
  }),
  action('shorten', 'Shorten', ['selection', 'block'], {
    allowedOps: ['replaceRange'],
    contextPolicy: 'targetOnly',
    instruction: 'Make the target Markdown more concise.',
    constraints: ['Preserve key meaning.', 'Remove redundancy.'],
  }),
  action('expand', 'Expand', ['selection', 'block'], {
    allowedOps: ['replaceRange'],
    contextPolicy: 'nearby',
    instruction: 'Expand the target Markdown with useful detail.',
    constraints: ['Stay consistent with nearby context.', 'Do not over-explain.'],
  }),
  action('rephrase', 'Rephrase', ['selection', 'block'], {
    allowedOps: ['replaceRange'],
    contextPolicy: 'targetOnly',
    instruction: 'Rephrase the target Markdown without changing meaning.',
    constraints: ['Preserve Markdown syntax.', 'Avoid equivalent no-op output.'],
  }),
  action('translate', 'Translate', ['selection', 'block', 'document'], {
    allowedOps: ['replaceRange', 'replaceDocument'],
    contextPolicy: 'focusedDocument',
    instruction: 'Translate the target Markdown according to the user directive or profile language.',
    constraints: ['Preserve Markdown structure.', 'Do not translate code identifiers unless asked.'],
  }),
  action('convert_to_list', 'Convert to list', ['selection', 'block'], {
    allowedOps: ['replaceRange'],
    contextPolicy: 'targetOnly',
    instruction: 'Convert the target Markdown into a clear list.',
    constraints: ['Use Markdown list syntax.', 'Keep all important points.'],
  }),
  action('extract_headings', 'Extract headings', ['document'], {
    allowedOps: ['replaceDocument', 'insertAt'],
    contextPolicy: 'wholeDocument',
    instruction: 'Create or refine a useful Markdown heading outline from the document.',
    constraints: ['Use valid heading hierarchy.', 'Avoid duplicate headings.'],
  }),
  action('outline_check', 'Outline check', ['document'], {
    allowedOps: ['comment'],
    contextPolicy: 'wholeDocument',
    instruction: 'Review the Markdown outline for structure, hierarchy, and missing sections.',
    constraints: ['Return comment operations only.', 'Do not modify the document.'],
  }, ['review']),
  action('consistency_check', 'Consistency check', ['document'], {
    allowedOps: ['comment'],
    contextPolicy: 'wholeDocument',
    instruction: 'Review the Markdown document for inconsistent terminology, tone, and claims.',
    constraints: ['Return comment operations only.', 'Cite the affected range precisely.'],
  }, ['review']),
  action('glossary_check', 'Glossary check', ['document'], {
    allowedOps: ['comment'],
    contextPolicy: 'wholeDocument',
    instruction: 'Review glossary and terminology consistency in the Markdown document.',
    constraints: ['Return comment operations only.', 'Prefer actionable terminology notes.'],
  }, ['review']),
];

export function getMarkdownActionsForScope(scope: MarkdownAction['targets'][number]): MarkdownAction[] {
  return builtInMarkdownActions.filter(action => action.targets.includes(scope));
}
