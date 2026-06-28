# Validation And Export

Use this knowledge after meaningful source changes or before export.

- Prefer refreshing the embedded Player preview for interaction and frame sync.
- Render a still when a single key frame is enough to validate visual hierarchy.
- Start export only when the composition, frame range, and source stability are clear.
- Never claim visual validation unless preview, still, or export evidence was obtained.

If render fails, report the concrete Remotion error and make the smallest reasoned recovery.
