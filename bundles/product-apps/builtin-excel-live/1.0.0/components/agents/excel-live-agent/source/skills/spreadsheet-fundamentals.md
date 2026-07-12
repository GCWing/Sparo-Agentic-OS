# Spreadsheet Fundamentals

Use this skill when interpreting workbook structure, data shape, or spreadsheet semantics.

- Address every claim with workbook, sheet, A1 range, and revision when available.
- Treat one record per row and one meaning per column as the default data model.
- Distinguish raw values, formulas, cached results, styles, number formats, headers, and genuinely empty cells.
- Formatting changes presentation, not the stored value. A raw serial does not prove date, currency, or percentage semantics.
- Preserve stable headers, units, keys, source columns, and intentional workbook conventions.
- Prefer a single rectangular data region with one clear header row. Avoid merged cells, repeated headers, and decorative blanks inside sortable data.
- Use a separate summary block or sheet when analytics would otherwise corrupt the source data shape.
- Track active sheet, dirty state, proposal state, calculation status, capability metadata, and source/export fidelity.
- Large or cache-incomplete ranges require summary/read tools. Never interpret unread cells as blanks.
- A portable result is a real source-safe XLSX/XLSM copy plus an honest fidelity report, not a chat-only table or overwritten source workbook.

Output should name the target range and explain the spreadsheet consequence of each proposed design decision.
