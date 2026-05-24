# Sparo Markdown Co-author Architecture

Sparo Markdown Co-author is the built-in collaboration layer for Markdown editing. It is not a Markdown editor with AI bolted on; it is a document co-authoring environment where AI can propose, review, and explain changes, but authors decide what lands in the document.

The product contract is:

- AI never writes directly to the document.
- AI yields a `DocumentEditProposal`.
- The frontend review layer owns preview, accept, reject, undo, stale detection, and final editor transactions.
- Built-in infrastructure owns editing safety; extensions only decide what proposal chunks to produce.

## Product Shape

There are three target scopes:

- `selection`: the current text selection.
- `block`: one top-level Markdown block, preferably addressed by `blockId`.
- `document`: the whole Markdown document.

There are two intents:

- `apply`: propose edits.
- `review`: comment only unless the author explicitly changes mode.

All surfaces feed the same review contract:

- Inline Pill for empty-block and Cmd+K continuation.
- Selection Bubble for selected text.
- Block Handle action menu.
- Co-author Bar for one-shot document tasks.
- Command palette actions.

The UI deliberately avoids a persistent document chat panel. A Co-author task is one request, one draft, one review lifecycle. Long-running multi-turn agent work belongs in Agent App surfaces.

## Proposal Protocol

The proposal protocol is the only format that can reach the review layer.

```ts
export type DocPosition =
  | { kind: 'blockId'; blockId: string; offset?: number }
  | { kind: 'markdownOffset'; offset: number }
  | { kind: 'lineCol'; line: number; column: number };

export type DocumentEditOp =
  | { id: string; type: 'replaceRange'; from: DocPosition; to: DocPosition; markdown: string; reason?: string }
  | { id: string; type: 'insertAt'; position: DocPosition; markdown: string; reason?: string }
  | { id: string; type: 'deleteRange'; from: DocPosition; to: DocPosition; reason?: string }
  | { id: string; type: 'comment'; from: DocPosition; to: DocPosition; message: string; severity?: 'info' | 'warning' | 'error' }
  | { id: string; type: 'replaceDocument'; markdown: string; summary?: string };

export type DocumentEditProposal = {
  proposalId: string;
  filePath?: string;
  sourceHash: string;
  scope: 'selection' | 'block' | 'document';
  intent: 'apply' | 'review';
  ops: DocumentEditOp[];
  summary?: string;
  modelId?: string;
  finishReason?: string;
};
```

Models should return `blockId` positions first. The frontend resolves `blockId` to current ProseMirror positions through the existing Markdown editor state, and falls back to Markdown offsets or line/column positions when needed.

`replaceDocument` is not allowed to overwrite the document directly. The frontend feeds it through `DiffService`, splits it into hunks, and renders the same review affordances as structured operations. If a model cannot produce schema-constrained output, the backend may fall back to `replaceDocument` plus client-side diff so the experience still works.

## Existing Code Anchors

The first implementation should reuse these existing pieces:

- `src/web-ui/src/tools/editor/meditor/extensions/BlockIdExtension.ts`: top-level block identity.
- `src/web-ui/src/tools/editor/meditor/extensions/InlineAiPreviewExtension.tsx`: current ProseMirror widget insertion path.
- `src/web-ui/src/tools/editor/meditor/components/InlineAiPreviewBlock.tsx`: starting point for a generalized suggestion widget.
- `src/web-ui/src/tools/editor/meditor/utils/tiptapMarkdown.ts`: Markdown editability analysis and unsafe Markdown detection.
- `src/web-ui/src/tools/editor/services/DiffService.ts`: document diff and hunk data.
- `src/apps/desktop/src/api/editor_ai_api.rs`: ephemeral editor AI transport, cancellation, and event emission.
- `src/web-ui/src/infrastructure/api/service-api/EditorAiAPI.ts`: frontend API wrapper for editor AI stream and cancel.
- `src/crates/core/src/agentic/side_question.rs`: cancellation runtime already used by editor AI.

## Frontend Engine

Add the Document Collaboration Engine under the Markdown editor feature boundary, for example:

```text
src/web-ui/src/tools/editor/coauthor/
  protocol.ts
  documentActions.ts
  suggestionStore.ts
  proposalSession.ts
  targetResolver.ts
  proposalApplier.ts
  staleDetector.ts
  profileResolver.ts
```

Responsibilities:

- `ProposalSession`: state machine for `Idle -> Submitting -> Streaming -> Reviewing -> Applied | Discarded | Failed | Stale`.
- `SuggestionStore`: Zustand store keyed by `proposalId` and indexed by `filePath`.
- `TargetResolver`: converts selection, block, and document targets to Markdown ranges and ProseMirror positions.
- `ProposalApplier`: applies accepted operations as editor transactions and groups one Co-author task into one primary history step.
- `StaleDetector`: compares `sourceHash` plus intersecting ranges after local edits.
- `ProfileResolver`: reads document profile from front matter first, then sidecar, then global defaults.

Suggestion proposals should not persist across file close. Comment operations are document metadata and can persist under `.sparo_os/coauthor/comments/<doc-hash>.json`.

## Review UI

The review layer has three render forms and one interaction contract:

- Inline Suggestion: `replaceRange`, `insertAt`, and `deleteRange`; original text is muted/struck, proposed text is highlighted, and a compact toolbar provides accept, reject, retry, and edit prompt.
- Comment Pin: `comment`; gutter pin plus floating card, without reflowing the document body.
- Document Diff Review: `replaceDocument` or many operations; top review bar plus inline hunks.

Keyboard contract:

- Cmd+Enter accepts the focused change.
- Cmd+Backspace rejects the focused change.
- Alt+Enter accepts all changes in the current proposal.
- Alt+Backspace rejects all changes in the current proposal.
- Escape cancels streaming or dismisses the active task when safe.

While streaming, suggestion content can grow incrementally and the action affordance is Cancel. When completed, it becomes Accept/Reject. Hover or focus should expose reason, model, and retry/edit prompt metadata.

## Document Actions

Built-in actions should ship through a registry rather than hard-coded UI branches.

```ts
export type DocumentAction = {
  id: string;
  title: string;
  group?: string;
  icon?: string;
  targets: Array<'selection' | 'block' | 'document'>;
  modes: Array<'apply' | 'review'>;
  inputSchema?: unknown;
  shortcut?: string;
  showWhen?: (ctx: DocumentActionContext) => boolean;
  run(ctx: DocumentActionContext): AsyncIterable<DocumentEditProposalChunk>;
};
```

Required built-ins:

- continuation
- summary
- todo extraction
- polish
- shorten
- expand
- rephrase
- translate
- convert to list
- extract headings
- outline check
- consistency check
- glossary check

Extensions may register actions, profiles, and context providers. They cannot write to the document. The engine enforces proposal-only output, rate limits, timeout, cancellation, stale checks, and review application.

## Backend API

Keep the existing `editor_ai_stream` path for plain inline text while adding a structured proposal stream:

```rust
pub struct EditorAiProposeEditsRequest {
    pub request_id: String,
    pub action_id: String,
    pub scope: DocumentScope,
    pub intent: DocumentIntent,
    pub file_path: Option<String>,
    pub source_hash: String,
    pub document_markdown: String,
    pub target: DocumentTarget,
    pub profile: Option<DocumentProfile>,
    pub user_directive: Option<String>,
    pub model_id: Option<String>,
}
```

Events:

- `editor-ai://proposal-chunk`
- `editor-ai://proposal-completed`
- `editor-ai://error`

The API remains ephemeral: no agent session, no dialog turn, no persistence writes. It should continue to use `ai_client_factory` and `side_question_runtime` cancellation. Desktop command code only serializes requests and emits events; shared business logic and prompt shaping belong in platform-agnostic core code.

Prompting requirements:

- Inject `action_id`, scope, intent, target, and profile as structured context.
- Ask for reasons in `profile.language` when available.
- Never log Markdown body, profile text, prompt text, API keys, or user secrets.
- Log only metadata such as `request_id`, `action_id`, `scope`, `intent`, `source_hash`, `model_id`, `op_count`, accepted/rejected counts, and latency.

## Profiles

Document Profile captures purpose, audience, tone, length, forbidden words, and language.

Storage precedence:

1. `coauthor:` front matter for portable document-owned profile data.
2. `<workspace>/.sparo_os/coauthor/profiles/<doc-hash>.json` for non-polluting document sidecar data.
3. Global default profile.

The Co-author Bar shows the active profile and supports disabling it for a single task.

## Safety Rules

- If `analyzeMarkdownEditability` marks a range unsafe, force Review mode or source-level diff review.
- For documents larger than the configured threshold, use structured summary plus target slices instead of sending the whole file.
- If the source changed while reviewing and the changed range intersects the proposal range, mark the affected operation stale and offer re-run or drop.
- Multiple tabs for the same file share the same `SuggestionStore` entries by `filePath`.
- `replaceDocument` always goes through `DiffService`.

## Completion Definition

The Markdown Co-author layer should be delivered as one complete capability, not as a staged partial rollout. A change is complete only when the core contract, all user-facing surfaces, the shared review layer, backend proposal transport, profile handling, extension boundary, safety paths, and validation coverage work together in the desktop Markdown editor.

The complete delivery includes:

- Frontend protocol types, proposal parsing, and fallback `replaceDocument` handling.
- `SuggestionStore`, proposal session state, stale hash utilities, and task-level history behavior.
- A generalized proposal-aware suggestion widget that preserves current inline AI behavior.
- Selection Bubble, Block Handle action entry, Co-author Bar, and command palette registration.
- Built-in `DocumentAction` registry entries for selection, block, and document actions.
- Inline suggestions, comment pins, document diff review, and shared accept/reject keyboard commands.
- `editor_ai_propose_edits` backend command, frontend API wrappers, proposal events, cancellation, and schema fallback.
- Document Profile resolver and UI with front matter, sidecar, and global-default precedence.
- Comment and profile sidecar persistence where required, with non-persistent transient suggestions.
- Extension boundary that allows actions to yield proposal chunks but never mutate documents directly.
- Logging and observability for proposal metadata only, with no Markdown body, profile text, prompt text, or secrets.
- Tests for protocol parsing, target resolution, stale detection, fallback diff review, accept/reject application, and major UI flows.

## Validation

Frontend changes should run:

```bash
pnpm run type-check:web
pnpm run check:i18n
pnpm run check:design-system
```

Backend changes should run the narrowest useful Rust check for touched crates, and desktop command changes should include the desktop crate check when practical.

## Non-goals

- Do not build a persistent chat history in the Markdown editor.
- Do not let plugins or actions directly mutate editor state.
- Do not create a second reusable UI system for Co-author controls.
- Do not route desktop-only concerns into `src/crates/core`.
