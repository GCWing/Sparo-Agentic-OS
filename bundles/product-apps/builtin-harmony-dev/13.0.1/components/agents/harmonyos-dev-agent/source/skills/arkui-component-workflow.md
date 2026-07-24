# ArkUI Component Workflow

For UI edits:
- Use selected screenshot or hierarchy context as a pointer.
- Search by visible text, accessibility id, component type, page path, resource key, and nearby component names.
- Read the target ETS files before editing.
- Keep layout changes localized and deterministic.
- Prefer ArkUI-native layout primitives and resource usage already present in the project.
- After editing, use GetFileDiff and then build/verify when feasible.
