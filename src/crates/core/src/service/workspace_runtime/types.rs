use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum WorkspaceRuntimeTarget {
    LocalWorkspace { workspace_root: PathBuf },
}

impl WorkspaceRuntimeTarget {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::LocalWorkspace { .. } => "local_workspace",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceRuntimeContext {
    pub target: WorkspaceRuntimeTarget,
    pub runtime_root: PathBuf,
    pub snapshots_dir: PathBuf,
    pub snapshot_by_hash_dir: PathBuf,
    pub snapshot_metadata_dir: PathBuf,
    pub snapshot_baselines_dir: PathBuf,
    pub snapshot_operations_dir: PathBuf,
    pub memory_dir: PathBuf,
    pub plans_dir: PathBuf,
    pub locks_dir: PathBuf,
    pub config_dir: PathBuf,
    pub isolation_status_file: PathBuf,
}

impl WorkspaceRuntimeContext {
    pub fn new(target: WorkspaceRuntimeTarget, runtime_root: PathBuf) -> Self {
        let snapshots_dir = runtime_root.join("snapshots");
        let config_dir = runtime_root.join("config");

        Self {
            target,
            snapshot_by_hash_dir: snapshots_dir.join("by_hash"),
            snapshot_metadata_dir: snapshots_dir.join("metadata"),
            snapshot_baselines_dir: snapshots_dir.join("baselines"),
            snapshot_operations_dir: snapshots_dir.join("operations"),
            memory_dir: runtime_root.join("memory"),
            plans_dir: runtime_root.join("plans"),
            locks_dir: runtime_root.join("locks"),
            isolation_status_file: config_dir.join("isolation_status.json"),
            runtime_root,
            snapshots_dir,
            config_dir,
        }
    }

    pub fn required_directories(&self) -> Vec<&Path> {
        vec![
            self.runtime_root.as_path(),
            self.snapshots_dir.as_path(),
            self.snapshot_by_hash_dir.as_path(),
            self.snapshot_metadata_dir.as_path(),
            self.snapshot_baselines_dir.as_path(),
            self.snapshot_operations_dir.as_path(),
            self.memory_dir.as_path(),
            self.plans_dir.as_path(),
            self.locks_dir.as_path(),
            self.config_dir.as_path(),
        ]
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceRuntimeEnsureResult {
    pub context: WorkspaceRuntimeContext,
    pub created_directories: Vec<PathBuf>,
}
