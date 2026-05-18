# Auto Memory

This module implements Sparo OS's background "auto extract memory" system.

Its job is to take durable user/project/collaboration facts from completed
dialog turns and update workspace memory files in the background, using a
forked hidden agent.

The implementation is intentionally close to Claude's extract-memories flow,
while adapting to Sparo OS's persisted-turn architecture.

## Goals

- Reuse forked-agent infrastructure so the extractor sees inherited
  conversation context and can benefit from prompt-cache reuse.
- Keep memory extraction best-effort and out of the main turn latency path.
- Avoid duplicate extraction when the main agent already wrote memory itself.
- Make extraction progress durable across context compaction, app restart, and
  history rollback.
- Prevent concurrent writes to the same workspace memory directory.

## Non-goals

- Remote auto-memory is not currently supported.
- The extractor does not try to perfectly mirror Claude's internal cache-key
  behavior; we only align the high-level architecture and prompt behavior.
- This system is not a general background-job framework. It is specialized for
  memory extraction.

## Main Files

- [manager.rs](./manager.rs)
  Workspace-level scheduler, queueing, and concurrency control.
- [types.rs](./types.rs)
  Durable extraction cursor and throttle state.
- [prompt.rs](./prompt.rs)
  Claude-like extractor prompt builder.
- [restrictions.rs](./restrictions.rs)
  Runtime tool/path restrictions for the fork.
- [coordinator.rs](../coordination/coordinator.rs)
  Turn-end trigger logic and fork execution.
- [session_manager.rs](../session/session_manager.rs)
  Durable auto-memory state transitions.

## High-level Flow

1. A main-session dialog turn completes.
2. The coordinator inspects whether that turn directly wrote workspace memory.
3. If yes, the extractor is skipped and the auto-memory cursor is advanced as
   if extraction had already consumed that turn range.
4. If no, the turn is treated as an eligible auto-memory turn.
5. Eligible-turn throttling is applied using global config.
6. Once the threshold is reached, the session is queued into the workspace's
   auto-memory worker.
7. The worker eventually runs one extraction cycle for that session.
8. The extraction cycle loads all persisted pending turns, builds a
   Claude-like prompt, launches a forked hidden agent with restricted tools,
   and commits cursor progress only if history revision still matches.

## Why persisted turns are the source of truth

Claude tracks progress with a message UUID cursor inside the current session
history.

Sparo OS instead uses persisted dialog turns as the authoritative extraction
source. This is important because:

- runtime context can be compacted
- the visible model context can lose older turns
- the app can restart
- the user can rollback history

Because of this, the extractor does not trust inherited fork context alone for
progress tracking. It uses persisted turns and durable session state.

This does not mean persisted turns are always injected as extraction input.

In the normal case, the forked extractor relies on inherited runtime context
messages from the parent session. Persisted turns are primarily used to:

- decide what still needs extraction
- persist cursor progress across restart/compaction
- recover from rollback and other history-shape changes

## Persisted Turns vs Runtime Context

These two concepts serve different roles in the current design.

### Runtime context

Runtime context is the default extraction input.

The forked extractor inherits the parent session's current model-visible
context and uses that as its working conversation history.

In normal operation, this is what the extractor reads when deciding what memory
to write.

### Persisted turns

Persisted turns are the durable progress and boundary source of truth.

They are used to:

- compute the pending extraction window
- remember progress across app restart
- keep progress correct when runtime context is compacted
- make rollback durable by truncating history and bumping revision
- inspect whether a completed turn already wrote workspace memory directly

They are not currently injected as a transcript-style extraction input during
normal operation.

### Practical rule of thumb

If the question is:

- "What messages does the extractor usually read?"
  The answer is runtime context.
- "What tells the system which turns still need extraction?"
  The answer is persisted turns plus durable auto-memory state.

## Durable State

`AutoMemoryState` currently stores:

- `next_unextracted_turn`
  The next persisted turn index that still needs auto-memory processing.
- `history_revision`
  Monotonic revision used to detect rollback races.
- `pending_eligible_turns`
  Durable count of eligible turns that have accumulated since the last
  committed extraction or direct memory write consumed pending history.
- `last_memory_consumed_at_ms`
  Timestamp of the last extraction commit or main-agent direct memory write
  that consumed pending history for cooldown gating.

State lives on the session and is persisted with session metadata.

## Cursor Semantics

### Normal extraction

When a forked extraction completes successfully, the session manager advances
`next_unextracted_turn` through the extracted turn window, resets the
eligible-turn counter, and records the last-consumed timestamp for interval
throttling.

### Context compaction

Context compaction does not move the cursor. The extraction source of truth is
persisted turn history, not the current in-memory conversation window.

Normal extraction input still comes from inherited runtime context. Compaction
matters because it can change what that runtime context contains, while durable
cursor progress still needs to remain correct.

### Rollback

Rollback clamps the cursor back to the rollback target, increments
`history_revision`, and resets eligible-turn throttling.

Extraction commits are revision-guarded. If history changed while a fork was
running, the commit is discarded.

### Main agent wrote memory directly

If the main agent already wrote workspace memory in that turn, Sparo OS follows
Claude's behavior:

- skip the extractor
- still advance the durable cursor through that turn

This keeps the system from repeatedly reconsidering already-consumed history.
It also updates the same last-consumed timestamp used by extraction cooldown
gating, so a direct write and a background extraction both count as "memory
was just updated".

## What counts as an eligible turn

An eligible turn is a completed top-level turn that:

- is not a subagent turn
- did not already directly write workspace memory
- is in a local session

Eligible turns increment `pending_eligible_turns`.

If the configured threshold has not been reached yet, nothing is scheduled and
the turn is simply counted toward the next extraction.

## Throttling

Global config lives under:

- `ai.auto_memory.global.enabled`
- `ai.auto_memory.global.extract_every_eligible_turns`
- `ai.auto_memory.global.min_extract_interval_secs`
- `ai.auto_memory.global.force_extract_after_pending_eligible_turns`
- `ai.auto_memory.workspace.enabled`
- `ai.auto_memory.workspace.extract_every_eligible_turns`
- `ai.auto_memory.workspace.min_extract_interval_secs`
- `ai.auto_memory.workspace.force_extract_after_pending_eligible_turns`

Behavior:

- scope selection follows the session's memory target
  `global` applies to `agentic_os` memory (`MemoryScope::GlobalAgenticOs`)
  and `workspace` applies to normal project memory
  (`MemoryScope::WorkspaceProject`)
- `enabled = false`
  Disables scheduling and execution for that scope, but eligible turns are
  still counted as pending backlog.
- `extract_every_eligible_turns = 1`
  Run after every eligible turn for that scope.
- `extract_every_eligible_turns = N`
  Run once there are at least N unextracted eligible turns for that scope,
  checked on each newly completed eligible turn.
- `min_extract_interval_secs = 0`
  Disable time-based cooldown for that scope.
- `min_extract_interval_secs = T`
  Require at least T seconds since the last extraction commit or direct memory
  write before the next auto-memory run may start.
- `force_extract_after_pending_eligible_turns = null`
  Disable cooldown bypass by pending backlog size.
- `force_extract_after_pending_eligible_turns = M`
  If at least `extract_every_eligible_turns` pending eligible turns have
  accumulated but cooldown has not expired yet, force extraction once pending
  backlog reaches M turns.

This is modeled after Claude's "every N eligible turns" extraction throttle,
but implemented durably on the session state instead of a transient closure
counter. Sparo OS extends that with a durable cooldown gate so scheduling can
respect all of:

- enough eligible turns have accumulated
- enough time has passed since the last memory-consuming update
- or pending eligible-turn backlog has grown large enough to bypass cooldown

If the turn threshold is met but cooldown has not expired yet, the session is
kept in the workspace worker's delayed queue and automatically wakes once the
cooldown deadline is reached, even if no new dialog turn arrives.

If pending backlog keeps growing while the session is cooling down and reaches
the configured force-extract threshold, the delayed session is promoted to run
immediately instead of waiting for the cooldown deadline.

## Scheduling and Concurrency

### Workspace is the correctness boundary

Workspace memory is shared by all sessions in the same workspace, so the
runtime conflict domain is the workspace, not the session.

For that reason, the scheduler uses a `workspace_key` as the mutual-exclusion
unit. Sessions from the same workspace are serialized through one workspace
worker.

### Global semaphore

On top of workspace serialization, the manager uses a global semaphore.
Current limit: `1`.

This means:

- same workspace: always serialized
- different workspaces: currently also serialized, because the global limit is
  `1`

The design intentionally separates these two concepts:

- workspace serialization protects shared memory files
- global semaphore controls API/provider concurrency

If we later relax the semaphore to `2+`, cross-workspace extraction can
parallelize without allowing same-workspace write races.

### Coalescing model

Claude keeps one in-flight extraction plus one latest pending context.

Sparo OS coalesces differently:

- persisted turns are durable, so we do not need to stash a "latest context"
- the workspace worker keeps a set of pending sessions
- the worker also tracks delayed sessions waiting for a cooldown deadline
- after a session run finishes, it requeues the session only if it still has
  pending auto-memory work

This makes coalescing naturally align with durable cursor progress.

## Fork Execution

The extractor runs through `ConversationCoordinator::execute_forked_agent(...)`,
not a func-agent.

Important properties:

- inherited parent conversation context
- hidden subagent session
- local-only for now
- bounded turn budget
- runtime tool restrictions

Current fork turn budget:

- `5`

## Tool and Path Restrictions

The fork is allowed to call only:

- `Read`
- `Glob`
- `Grep`
- `Write`
- `Edit`
- `Delete`

Path restrictions allow mutation only inside the resolved workspace memory
directory.

This is implemented as runtime restriction, not by changing the model-visible
tool list. That keeps the architecture aligned with the Claude approach where
prompt-cache friendliness matters.

For local workspaces, the restriction uses the real absolute memory directory
path, not a virtual URI scheme.

## Prompt Strategy

The extractor prompt aims to stay close to Claude's extract-memories prompt.

It includes:

- a "memory extraction subagent" framing
- explicit allowed-tool guidance
- limited-turn-budget guidance
- instruction to use only the recent inherited messages
- an existing-memory manifest
- shared memory policy sections reused with the main memory prompt
- `MEMORY.md`-based save instructions aligned with the main memory system

The `~N messages` value is intentionally Claude-like.

Sparo OS computes it from the fork's inherited runtime context, not from a
persisted-turn estimate:

- start from the last runtime message belonging to the most recently
  extracted turn
- count later model-visible runtime messages in the inherited fork context
- include tool-result messages in that count, because they are part of the
  model-visible conversation flow
- if that boundary turn is no longer present in runtime context
  (for example after compaction), fall back to counting all currently visible
  runtime messages

This keeps the prompt wording aligned with what the extractor can actually see
above, while durable extraction progress still comes from persisted turns.

## Existing Memory Manifest

Before launching the fork, the system scans existing memory files and builds a
manifest. This helps the extractor:

- update existing files instead of duplicating them
- reason about current memory coverage
- avoid spending turns on mechanical file discovery

## Remote Behavior

Remote auto-memory is currently disabled.

The coordinator will not report pending auto-memory and will not run extraction
cycles for remote sessions.

## Failure Behavior

Auto-memory is best-effort.

If a fork fails:

- the main turn still succeeds
- the cursor is not advanced
- the same pending turn window can be retried later

If history changed mid-run:

- the fork result is ignored for cursor-commit purposes
- a later cycle will re-read the updated persisted history

## Current Limitations

- No remote auto-memory yet.
- The global semaphore is hard-coded to `1`.
- There is no dedicated UI for auto-memory settings yet; config exists at the
  shared config layer.

## Why this document lives here

Putting this document under `agentic/auto_memory` keeps the design next to the
implementation and state machine it describes.

This system has several interacting rules:

- durable cursor semantics
- rollback revision-guarding
- Claude-style throttling
- workspace-level serialization
- global concurrency limiting
- direct-write mutual exclusion with the main agent

Keeping the design local to the module makes it much easier to safely evolve
the implementation without rediscovering those rules from scattered call sites.
