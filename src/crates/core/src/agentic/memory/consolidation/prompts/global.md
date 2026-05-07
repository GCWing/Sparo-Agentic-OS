# Task

Update the global memory files from the provided journal slice.

# Memory File Paths

- `GLOBAL.SOUL`: `{global_soul_file_path}`
- `GLOBAL.USER`: `{global_user_file_path}`
- `GLOBAL.MEMORY`: `{global_memory_file_path}`

# Run-Specific Notes

- Process only the journal entries included below. They represent new append-only logs since the last completed consolidation cursor.
- Update only `GLOBAL.SOUL`, `GLOBAL.USER`, and `GLOBAL.MEMORY` in this run.

# Journal Context

{journal_context}
