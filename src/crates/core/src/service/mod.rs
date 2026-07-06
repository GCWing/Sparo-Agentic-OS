//! Service layer module
//!
//! Contains core business logic: Workspace, Config, FileSystem, Agentic, MCP.

pub mod announcement; // Announcement / feature-demo / tips system
pub mod config; // Config management
pub mod context_stats; // Context budget estimation and snapshots
pub mod cron; // Scheduled jobs
pub mod daily_letter; // Today letter runtime, storage, and receipts
pub mod file_watch;
pub mod files;
pub mod files_context;
pub mod filesystem; // FileSystem management
pub(crate) mod global_daily_report; // Agentic OS global daily report runtime and scheduling
pub(crate) mod global_milestone; // Agentic OS global milestone runtime and scheduling
pub(crate) mod host; // Agentic OS host-level runtime context and scan prompts
pub mod i18n; // I18n service
pub(crate) mod instructions; // Instruction memory (AGENTS.md / CLAUDE.md style files)
pub mod mcp; // MCP (Model Context Protocol) system
pub mod project_detection; // Workspace project / language detection
pub mod remote_connect; // Remote Connect (phone → desktop)
pub mod runtime; // Managed runtime and capability management
pub mod session; // Session persistence
pub mod snapshot; // Snapshot-based change tracking
pub mod system; // System command detection and execution
pub mod system_fs;
pub mod token_usage; // Token usage tracking
pub mod workspace; // Workspace management
pub(crate) mod workspace_overview; // Agentic OS workspace routing overview runtime context and refresh
pub mod workspace_runtime;
pub mod workspace_session; // Local workspace session identity helpers // Workspace runtime layout and initialization

// agentshell is a standalone crate; re-export it here as `terminal` for backward compatibility.
pub use agentshell as terminal;

// Re-export main components.
pub use announcement::{AnnouncementCard, AnnouncementScheduler, AnnouncementSchedulerRef};
pub use config::{ConfigManager, ConfigProvider, ConfigService};
pub use cron::{
    get_global_cron_service, install_global_cron_service, CronEventSubscriber, CronService,
};
pub use daily_letter::{
    get_global_daily_letter_service, global_daily_letter_markdown_path,
    global_daily_letters_output_dir, install_global_daily_letter_service,
    DailyLetterApplyReceiptsRequest, DailyLetterAttemptStatus, DailyLetterGenerateRequest,
    DailyLetterGetRequest, DailyLetterListRequest, DailyLetterRecord, DailyLetterRunSummary,
    DailyLetterScope, DailyLetterSealRequest, DailyLetterService, DailyLetterState,
    DailyLetterTrigger, DailyLetterUpdateContinuationRequest,
};
pub use file_watch::{
    get_global_file_watch_service, get_watched_paths, initialize_file_watch_service,
    start_file_watch, stop_file_watch, FileWatchEvent, FileWatchEventKind, FileWatchService,
    FileWatcherConfig,
};
pub use files::{
    archive_path_to_zip, confirmation_token_for_plan, copy_path_recursive, default_archive_path,
    default_extract_path, execute_file_operation_plan_with, extract_zip_to_dir,
    move_path_recoverably, plan_file_operations, FileEntry as WorkbenchFileEntry,
    FileEntryKind as WorkbenchFileEntryKind, FileOperationApplyResult, FileOperationAuditRecord,
    FileOperationIntent, FileOperationItemResult, FileOperationPlan, FileOperationPlanItem,
    FileOperationPlanStatus, FileOperationRecovery, FileOperationType, FileSafetyReview,
    FileSafetyRisk, FileScope as WorkbenchFileScope,
};
pub use files_context::{
    clear_files_context, get_files_context, render_files_context_prompt, stash_files_context,
    FilesContext, FilesContextScope, FilesContextSelection, FilesContextSelectionKind,
    FilesContextSummary, FilesContextSummaryCategory,
};
pub use filesystem::{DirectoryStats, FileSystemService, FileSystemServiceFactory};
pub use global_daily_report::{
    get_global_global_daily_report_service, install_global_global_daily_report_service,
    GlobalDailyReportEventSubscriber, GlobalDailyReportService,
};
pub use global_milestone::{
    get_global_global_milestone_service, install_global_global_milestone_service,
    GlobalMilestoneEventSubscriber, GlobalMilestoneRunSummary, GlobalMilestoneService,
};
pub use host::{
    get_global_host_auto_scan_service, install_global_host_auto_scan_service,
    HostAutoScanEventSubscriber, HostAutoScanService, HostScanRunSummary, HostScanTrigger,
};
pub use i18n::{get_global_i18n_service, I18nConfig, I18nService, LocaleId, LocaleMetadata};
pub use mcp::MCPService;
pub use project_detection::{ProjectDetector, ProjectInfo};
pub use runtime::{ResolvedCommand, RuntimeCommandCapability, RuntimeManager, RuntimeSource};
pub use snapshot::SnapshotService;
pub use system::{
    check_command, check_commands, run_command, run_command_simple, CheckCommandResult,
    CommandOutput, SystemError,
};
pub use system_fs::{
    create_dir as system_create_dir, create_file as system_create_file,
    delete_path as system_delete_path, list_dir as system_list_dir,
    list_drives as system_list_drives, list_quick_folders as system_list_quick_folders,
    open_with_default as system_open_with_default, reveal_in_os as system_reveal_in_os,
    stat as system_stat, DriveInfo, FsEntry, FsEntryKind, OperationResult, QuickFolder,
    SystemFsService,
};
pub use token_usage::{
    ModelTokenStats, SessionTokenStats, TimeRange, TokenUsageQuery, TokenUsageRecord,
    TokenUsageService, TokenUsageSummary,
};
pub use workspace::{WorkspaceManager, WorkspaceProvider, WorkspaceService};
pub use workspace_overview::{
    get_global_workspace_overview_auto_refresh_service,
    set_global_workspace_overview_auto_refresh_service,
    WorkspaceOverviewAutoRefreshEventSubscriber, WorkspaceOverviewAutoRefreshService,
    WorkspaceOverviewRefreshRunSummary,
};
pub use workspace_runtime::{
    get_workspace_runtime_service_arc, try_get_workspace_runtime_service_arc,
    RuntimeMigrationRecord, WorkspaceRuntimeContext, WorkspaceRuntimeEnsureResult,
    WorkspaceRuntimeService, WorkspaceRuntimeTarget,
};
