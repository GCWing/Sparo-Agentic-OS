# Workbook Authoring

Use this skill for end-to-end spreadsheet creation or a substantial new sheet.

## Start with the decision

Infer or ask only what materially changes the design:

- purpose and decision supported;
- audience and expected editing behavior;
- source data and update cadence;
- required inputs, calculations, summaries, and handoff format;
- compatibility or fidelity constraints, especially for imported xlsm files.

Do not begin with colors. Design the workbook's information architecture first.

## Recommended architecture

Use only the sections the task needs:

1. title/context: purpose, period, owner, or last-updated note;
2. input/data region: one record per row, one meaning per column, stable headers;
3. calculation region: transparent helper columns or formulas;
4. summary/decision region: totals and the few measures the audience acts on;
5. notes/definitions: assumptions, units, caveats, and provenance.

Separate raw inputs from derived outputs visually. Prefer a new sheet to destructive reshaping when source preservation matters. Sheet names should be short, unique, and meaningful.

## Authoring sequence

1. Inspect metadata/capabilities and existing workbook conventions.
2. Add or rename a sheet only when needed. Structure tools commit immediately, require the current revision, and remain undoable.
3. Propose the core table content, formulas, styles, formats, and layout together when the design is coherent enough for one review.
4. Inspect proposal validation and formula lint. Resolve failures instead of narrating them as success.
5. Ask for grid Accept/Reject. Read the committed result after acceptance.
6. Export a distinct source-safe xlsx/xlsm copy only when requested, and report the returned fidelity contract.

## Quality bar

A professional workbook is:

- structurally clear without explanation from the author;
- easy to scan at normal zoom;
- explicit about editable inputs and calculated outputs;
- resilient to blanks, missing matches, zero denominators, and row growth where relevant;
- consistent in labels, units, formats, precision, and formula patterns;
- restrained rather than template-heavy;
- honest about calculations and export fidelity;
- reversible and reviewable in the live grid.

Do not claim completion merely because cells were populated. Verify content, formulas, visual hierarchy, layout, proposal state, and requested export separately.
