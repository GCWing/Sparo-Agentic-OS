# Prompt Builder Notes

This directory owns prompt assembly boundaries for agent system prompts and per-request context reminders.

## Request Context Rules

- Put only dynamic, request-scoped content in request context.
- Good request-context candidates include workspace instruction files, recent workspace snapshots, memory file excerpts, project layout snapshots, and other data that may differ by workspace, session, or turn.
- Do not put fully static policy or identity text in request context. Stable behavior, role definition, and evergreen operating guidance belong in the agent's system prompt template under `src/crates/core/src/agentic/agents/prompts/`.

## Editing Guidance

- Keep request-context assembly simple and order-based unless a specific prompt contract requires grouping.
- Avoid duplicating the same instruction across request context and system prompt unless a deliberate override mechanism is required.
