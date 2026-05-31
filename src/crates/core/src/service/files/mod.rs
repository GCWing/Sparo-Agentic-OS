pub mod audit;
pub mod model;
pub mod operations;
pub mod safety;

pub use audit::{
    FileOperationApplyResult, FileOperationAuditRecord, FileOperationItemResult,
    FileOperationRecovery,
};
pub use model::{
    FileEntry, FileEntryKind, FileOperationPlan, FileOperationPlanItem, FileOperationPlanStatus,
    FileOperationType, FileScope,
};
pub use operations::executor::{confirmation_token_for_plan, execute_file_operation_plan_with};
pub use operations::fs_ops::{
    archive_path_to_zip, copy_path_recursive, default_archive_path, default_extract_path,
    extract_zip_to_dir, move_path_recoverably,
};
pub use operations::planner::{plan_file_operations, FileOperationIntent};
pub use safety::{review_file_operation, FileSafetyReview, FileSafetyRisk};
