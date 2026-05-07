# Task

Update the workspace memory files from the provided journal slice.

# Memory File Paths

- `WORKSPACE.MEMORY`: `{workspace_memory_file_path}`
- `GLOBAL.SOUL`: `{global_soul_file_path}`
- `GLOBAL.USER`: `{global_user_file_path}`
- `GLOBAL.MEMORY`: `{global_memory_file_path}`

# Run-Specific Notes

- Process only the journal entries included below. They represent new append-only logs since the last completed consolidation cursor.
- Update `WORKSPACE.MEMORY` for durable workspace-specific memory.
- Only update `GLOBAL.*` if the workspace journal reveals durable cross-workspace memory.

# Journal Context

{journal_context}
