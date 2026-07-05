# Office Documents Suite Router

Use this suite when the user asks to create, inspect, edit, convert, or verify Office-style artifacts.

Route to one member skill by artifact type:

- `docx`: Word documents, DOCX redlines, comments, or page-rendered document QA.
- `pdf`: PDF reading, extraction, generation, rendering, or page-level visual verification.
- `pptx`: PowerPoint decks and presentation files.
- `xlsx`: Excel workbooks, CSV/TSV-style spreadsheet work, formulas, charts, and recalculation.

If the request spans multiple artifact types, load the relevant member skills one at a time as the work reaches each format.
