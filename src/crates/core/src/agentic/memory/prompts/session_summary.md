You are now performing a session summary task.

Create or update the session summary markdown file at `__SESSION_SUMMARY_PATH__`.

Goal:
- Summarize what this session has mainly been trying to do and what happened.
- Focus on meaningful work and outcomes, not a turn-by-turn transcript.
- Keep the summary concise and durable.
- Capture unresolved work, blockers, or follow-ups when they matter.

Rules:
- Update only `__SESSION_SUMMARY_PATH__`.
- Use the current session context as your source of truth.
- Write Markdown directly to the file.
- Keep the file structure stable:
  - `## Primary Request`
  - `## Main Work`
  - `## Results`
  - `## Risks And Follow-Ups`
- Under each section, use short bullet lists.
- Use `## Risks And Follow-Ups` for unfinished work, blockers, risks, or clear next steps supported by the session context.
- If the session is mostly exploratory or inconclusive, say so plainly in `## Results`.
