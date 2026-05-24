import { editorAiAPI } from '@/infrastructure/api/service-api/EditorAiAPI';
import type { DocumentAction, DocumentActionContext, DocumentEditProposalChunk } from './protocol';

const REQUEST_TIMEOUT_MS = 90_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 12;
const requestStarts: number[] = [];

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

async function* runBackendProposal(ctx: DocumentActionContext): AsyncIterable<DocumentEditProposalChunk> {
  if (!checkRateLimit()) {
    yield { type: 'error', error: 'Too many co-author requests. Please pause briefly and try again.' };
    return;
  }

  const requestId = `coauthor-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  let cleanupChunk: () => void = () => {};
  let cleanupComplete: () => void = () => {};
  let cleanupError: () => void = () => {};
  let timeoutId: number | null = null;

  const queue: DocumentEditProposalChunk[] = [];
  let done = false;
  let wakeWaiting: (() => void) | null = null;

  const wake = () => {
    wakeWaiting?.();
    wakeWaiting = null;
  };

  cleanupChunk = editorAiAPI.onProposalChunk((event) => {
    if (event.requestId !== requestId) {
      return;
    }
    queue.push(event.chunk);
    wake();
  });
  cleanupComplete = editorAiAPI.onProposalCompleted((event) => {
    if (event.requestId !== requestId) {
      return;
    }
    queue.push({ type: 'proposal', proposal: event.proposal });
    done = true;
    wake();
  });
  cleanupError = editorAiAPI.onError((event) => {
    if (event.requestId !== requestId) {
      return;
    }
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
    void editorAiAPI.cancel({ requestId });
    wake();
  }, REQUEST_TIMEOUT_MS);

  try {
    await editorAiAPI.proposeEdits({
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
  targets: DocumentAction['targets'],
  modes: DocumentAction['modes'] = ['apply'],
  group = 'Co-author',
): DocumentAction => ({
  id,
  title,
  group,
  targets,
  modes,
  run: runBackendProposal,
});

export const builtInDocumentActions: DocumentAction[] = [
  action('rewrite_selection', 'Rewrite selection', ['selection']),
  action('continuation', 'Continue writing', ['block', 'document']),
  action('summary', 'Summarize', ['selection', 'block', 'document']),
  action('todo_extraction', 'Extract todos', ['selection', 'block', 'document']),
  action('polish', 'Polish', ['selection', 'block', 'document']),
  action('shorten', 'Shorten', ['selection', 'block']),
  action('expand', 'Expand', ['selection', 'block']),
  action('rephrase', 'Rephrase', ['selection', 'block']),
  action('translate', 'Translate', ['selection', 'block', 'document']),
  action('convert_to_list', 'Convert to list', ['selection', 'block']),
  action('extract_headings', 'Extract headings', ['document']),
  action('outline_check', 'Outline check', ['document'], ['review']),
  action('consistency_check', 'Consistency check', ['document'], ['review']),
  action('glossary_check', 'Glossary check', ['document'], ['review']),
];

export function getDocumentActionsForScope(scope: DocumentAction['targets'][number]): DocumentAction[] {
  return builtInDocumentActions.filter(action => action.targets.includes(scope));
}
