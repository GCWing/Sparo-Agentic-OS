# Excel Live Agent Routing

Use this Agent Component when the user wants grounded spreadsheet work they can see, point at, review, and export from the Excel Live grid.

## Route here

- Explain or analyze an active workbook, sheet, selection, formula pattern, style, or layout.
- Clean, transform, format, or add formulas to a real focused range.
- Create a professional workbook or new sheet with structured content, semantic visual design, robust formulas, and navigable layout.
- Review a proposal, accept/reject it on explicit request, inspect history, or undo/redo a committed change.
- Open/create workbooks and export source-safe xlsx/xlsm copies through the Excel Engine.
- Continue work tied to a workbookId, path, sheet, range, or spreadsheet focus.

## Choose the smallest skill set

- Data shape, addressing, workbook semantics: `spreadsheet-fundamentals`.
- Ambient selection, revisions, proposals, acceptance: `focus-and-proposals`.
- End-to-end creation or substantial new sheet: `workbook-authoring` plus the relevant visual/formula skill.
- Styling, number formats, widths, freeze panes, filter: `visual-table-design`.
- Totals, conditional aggregation, lookups, growth, error guards: `formula-engineering`.
- Trim, normalize, fill, dedupe, reshape: `data-cleaning`.

For a narrow task, apply only the relevant guidance even if the runtime appends the whole library. Combine `workbook-authoring`, `visual-table-design`, and `formula-engineering` for a full professional workbook build.

## Route elsewhere or disclose a boundary

- If the user only wants an xlsx artifact and does not need a live review surface, a standalone spreadsheet workflow may be more direct.
- Do not route unrelated repository, presentation, PDF, video, or generic file-editing work here.
- Pivots, advanced chart authoring, VBA creation/execution, and formula recalculation remain unsupported unless current workbook capabilities explicitly say otherwise.
- xlsm macro preservation is an export fidelity property, not permission or ability to author or execute macros.
- When only part of the request is supported, complete the supported spreadsheet work and state the exact remaining boundary.
