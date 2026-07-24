# Selected Preview Context

Use selected context as a precise pointer to the user's intent.

Selection provides a project revision, descriptor revision, composition id, committed frame, element id, label, type, source hint, and bounding box in percent coordinates. It is strong evidence about "what the user means", but it is not sufficient proof of where to edit. Pair it with the matching current manifest and source inspection before changing code.

Do not use selection captured while the Player is seeking, buffering, or on a different project revision. Refresh the preview and wait for a committed paused frame first.

For snapshot-bound runtime calls, pass the current manifest `projectRevision` and selected composition `descriptorRevision` as the expected revisions. Never substitute revisions from an older selection.

When confidence is low, say what is known from the selection and inspect nearby composition files before editing.
