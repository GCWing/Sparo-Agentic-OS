# Focus and Proposals

Use ambient focus as the default target and proposal-based writes as the default content, formula, style, and layout mutation path.

## Live store

- The grid persists every accepted or local edit into a revisioned `<workspace>/.sparo_os/excel-live/<workbookId>/workbook.json` store with undo/redo history.
- That live store is the source of truth for range reads and focus. Do not call accepted changes invisible or unsaved merely because no export was created.
- `save_workbook` creates a portable copy; it never overwrites the imported source by default.

## Point

- Ambient focus contains sheet, A1, selection kind, workbook revision, cache coverage, and sometimes preview data.
- A mentioned A1 range explicitly overrides ambient focus. Pinned focus is useful for a fixed multi-turn target.
- Restate the target before transforming. If focus is missing, call `get_focus`; ask one short question only if it remains ambiguous.
- Use preview values only when cache coverage and revision are current. Formula results also require explicit freshness.

## Transform

- Content, formula, style, number-format, and layout writes go through `propose_patch` with a concise intent and exact expected revision.
- Inspect existing content, style, and layout before redesigning. Prefer semantic roles and combine related content, formulas, styling, and layout into one coherent proposal.
- Style-only and layout-only proposals are valid. Never add dummy content to carry a design change.
- Resolve an existing active proposal before creating another one.
- Structure operations are exceptional: `edit_workbook_structure` commits immediately, is history-backed, and requires explicit current intent.

## Verify

- Point -> Transform -> Verify is the north-star loop.
- Inspect actual bridge status and output after every tool. Only `completed` with valid output is success.
- After proposing, check proposal id, base revision, affected range, content/style/layout diff, validation, and formula lint.
- Formula lint is not recalculation. Layout changes are accepted or rejected with the proposal as a whole.
- A failed, cancelled, stale, or revision-conflicted call must be reported as failure. Refresh metadata before retrying a still-valid change.
- Tool cards summarize; the grid proposal inspector is the review surface. Ask the user to Accept or Reject there.
- Accepted changes remain reversible through workbook history.

Export only when a portable file is requested, use the exact committed revision, and report the returned path and fidelity limits.
