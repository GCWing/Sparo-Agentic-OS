# Data Cleaning

Use this skill when normalizing, deduplicating, filling, trimming, or reshaping tabular data in a focused range.

Workflow:
1. Point: confirm sheet + A1 focus, cache completeness, and workbook revision.
2. Summarize or read the range before changing anything.
3. Describe the cleaning plan (what columns, what rules, approximate cell count).
4. Propose a patch with explicit after values or formulas, user-facing intent, and expected revision.
5. Ask the user to Accept/Reject on the grid, then optionally save.

Common patterns:
- Trim whitespace and normalize casing in text columns.
- Coerce numeric-looking strings to numbers when the column is clearly numeric.
- Fill or flag blanks according to the user's rule; do not invent business values.
- Remove or collapse duplicate rows only when the key columns are clear.
- Split or merge columns only with an explicit target layout.
- Preserve header rows unless the user asks to rewrite them.

Honesty rules:
- Never invent cell values for unread areas.
- Prefer scoped patches over whole-sheet rewrites.
- High-risk clears or mass deletes must be called out in proposal validation and remain undoable after acceptance.
- If cleaning needs external Excel-only features, say so and keep the patch within Excel Live capabilities.
