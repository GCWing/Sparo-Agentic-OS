# Visual Table Design

Use this skill when improving readability, hierarchy, number presentation, or navigation.

## Design from semantics

Inspect existing styles and layout first. Assign roles before custom colors:

- `title`: workbook or section identity, used sparingly.
- `header`: field labels and filter row.
- `input`: editable assumptions or human-entered fields.
- `output`: calculated or decision-relevant results.
- `total`: subtotals, grand totals, and key rollups.
- `note`: instructions, provenance, caveats, or definitions.
- `warning`: true exceptions requiring attention, never ordinary emphasis.

Use custom style overrides only to refine a coherent direction. Normally use one accent plus neutrals, quiet body cells, and a single warning treatment. Avoid rainbow categories, heavy borders around every cell, low-contrast text, and decorative blank regions.

## Hierarchy and layout

- Put a title/context area above a table only when it helps the audience understand purpose or period.
- Keep one unambiguous header row for the data region. Auto-filter that header and data range, not the title row.
- Freeze the minimum context needed: commonly one header row, sometimes identifier columns.
- Auto-fit unpredictable content, then use deliberate widths for IDs, dates, measures, and narrative text. Layout start/end indices are 0-based and inclusive; column widths use Excel character units and row heights use points, never pixels.
- Wrap long notes and narrative columns deliberately. Avoid wrapping compact numbers and IDs.
- Align text left and numbers right by default. Use centered alignment sparingly for short categorical headers/statuses.
- Avoid merged cells inside data regions because they obstruct sorting, filtering, and formula fill.

## Number formats

Formatting changes presentation, not values:

- currency: choose symbol and decimal precision appropriate to the audience;
- percentage: store ratios as numeric values and apply a percent format;
- date: use a real date value when known, then a consistent date format;
- counts: normally use grouped whole numbers;
- measures: use consistent precision within a column;
- negatives: choose a consistent minus or accounting convention rather than mixing forms.

Do not infer currency, percentage, or date semantics from a raw number alone. Read headers and supporting metadata.

## Proposal composition

For a coherent makeover, use one `propose_patch` with operations that combine:

1. required content/formulas;
2. semantic roles;
3. sparse custom overrides;
4. number formats;
5. widths/heights or auto-fit;
6. freeze panes and auto-filter.

Style-only and layout-only proposals are valid. Review the whole visual diff on the grid. Layout is accepted or rejected with the proposal as a whole.

Clearing is explicit: `style: null` clears a cell's full style; nested nulls remove individual style properties; `columns: []` and `rows: []` clear custom bands; freeze counts of 0 clear frozen panes; `autoFilter: null` clears the filter. Omitted fields preserve existing design state.
