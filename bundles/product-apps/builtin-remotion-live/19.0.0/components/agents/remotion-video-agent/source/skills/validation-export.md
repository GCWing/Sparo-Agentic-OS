# Validation And Export

Use this knowledge after meaningful source changes or before export.

- Prefer refreshing the embedded Player preview for interaction and frame sync.
- Render a still when a single key frame is enough to validate visual hierarchy.
- Start export only when the composition, frame range, and source stability are clear.
- Pass the current manifest and composition revisions through `expectedProjectRevision` and `expectedDescriptorRevision` for every composition-scoped frame descriptor, preview, still, and export operation.
- Keep the returned run id, monitor progress until a terminal status, and use explicit cancellation when the user stops the job.
- Treat `queued`, `running`, and `cancelling` as non-terminal; only `completed`, `failed`, or `cancelled` closes the job.
- Never claim visual validation unless preview, still, or export evidence was obtained.

If render fails, report the concrete Remotion error and make the smallest reasoned recovery.
