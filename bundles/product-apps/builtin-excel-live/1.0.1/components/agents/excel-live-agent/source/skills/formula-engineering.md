# Formula Engineering

Use this skill when a workbook needs maintainable calculations, lookups, business rules, or summary metrics.

## Engineering loop

1. Read the actual headers, example rows, data extent, current formulas, and calculation metadata.
2. State the business definition in words before encoding it. Identify inputs, output unit, blank/error behavior, and compatibility needs.
3. Choose the simplest formula family that remains correct when rows are added or copied.
4. Write formulas through `propose_patch`, preferably with a number format and output style role in the same proposal.
5. Inspect static lint and reference findings. Spot-check first, middle, and last copied formulas.
6. Report formula authorship, lint, recalculation, and numeric verification as separate states.

## Reliable patterns

- Totals: `SUM` for a known contiguous measure range; avoid accidental header or total-row inclusion.
- Conditional aggregation: `SUMIFS`, `COUNTIFS`, and `AVERAGEIFS` with equally sized criteria and sum ranges.
- Lookups: `XLOOKUP` when workbook compatibility allows it; `INDEX` + `MATCH` when broader compatibility is required. Define missing-match behavior explicitly.
- Growth: guard the prior period before `(current-prior)/prior`; decide whether zero/blank should yield blank, zero, or an explicit error.
- Dates: use date functions rather than string slicing when cells contain real dates. Apply a date number format separately.
- Error handling: use `IFERROR` only for expected failure modes. Do not hide malformed inputs or broken references.
- Readability: prefer a helper column or small summary block over deeply nested repeated logic.

## Reference discipline

- Use relative references for row-local calculations, absolute references for fixed assumptions, and mixed references for fill-across/fill-down models.
- Quote sheet names containing spaces or punctuation.
- Never fabricate a named range, table name, or sheet name that was not read or created.
- Structure edits can invalidate references and are blocked when the engine cannot rewrite them safely.
- Avoid volatile functions such as `OFFSET`, `INDIRECT`, `NOW`, or `RAND` unless the user explicitly needs their behavior and accepts the tradeoff.

## Truthful verification

`formulaStaticLint=true` can support claims about supported syntax and detectable reference issues. It cannot support claims about the computed number.

When `formulaRecalculation=false`, use language equivalent to: "The formulas were added and statically checked; Excel Live did not recalculate them, so the displayed numeric results require recalculation in Excel before they are considered verified."

Never convert a formula to a hard-coded number merely to make a stale result look complete unless the user explicitly requests a snapshot and the computation was independently grounded.
