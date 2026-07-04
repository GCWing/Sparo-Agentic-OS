use serde::{Deserialize, Serialize};

use super::execution_binding::WorkExecutionBinding;
use super::ids::WorkId;
use super::record::{ArtifactRef, RuntimeInstanceRef};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkRuntimeRunStatus {
    Pending,
    Running,
    WaitingUser,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkRuntimeInstanceStatus {
    Idle,
    Running,
    WaitingUser,
    Completed,
    Degraded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkRuntimeIssueSeverity {
    Fatal,
    Warning,
    Noise,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkRuntimeLogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WorkStudioPreviewKind {
    ProductAppPreview,
    AgentChat,
    Sidecar,
    FullApp,
    Embedded,
    Capability,
    AgentEval,
    RuntimeBoundary,
    RuntimeDependencies,
    PermissionReview,
    UserPathRehearsal,
    ReleaseRehearsal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WorkStudioPreviewSource {
    RuntimeFact,
    RuntimeObservation,
    PreviewHarness,
    FixRerun,
    ReleaseRehearsal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkStudioFactStatus {
    Passed,
    Warning,
    Failed,
    NotRun,
    NotVerified,
    Blocked,
    Running,
    Ready,
    Waiting,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WorkStudioValidationTargetKind {
    ProductApp,
    Component,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkStudioFactCheck {
    pub id: String,
    pub status: WorkStudioFactStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkStudioIssueStatus {
    Open,
    Acknowledged,
    StillOpen,
    Regressed,
    Fixed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WorkStudioIssueOrigin {
    RuntimeEvent,
    WorkExecutionGraph,
    Validation,
    Preview,
    UserFeedback,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkRuntimeRun {
    pub run_id: String,
    pub runtime_instance_id: String,
    pub component_id: String,
    pub component_kind: String,
    pub action: String,
    pub status: WorkRuntimeRunStatus,
    pub started_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub artifact_count: usize,
    #[serde(default)]
    pub event_count: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkRuntimeIssue {
    pub runtime_instance_id: String,
    pub product_app_id: String,
    pub component_id: String,
    pub severity: WorkRuntimeIssueSeverity,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub timestamp_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkRuntimeLog {
    pub runtime_instance_id: String,
    pub product_app_id: String,
    pub component_id: String,
    pub level: WorkRuntimeLogLevel,
    pub category: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    pub timestamp_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkStudioPreviewResult {
    pub id: String,
    pub kind: WorkStudioPreviewKind,
    pub status: WorkStudioFactStatus,
    #[serde(default = "default_studio_preview_source")]
    pub source: WorkStudioPreviewSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub harness_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trigger_turn_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub checks: Vec<WorkStudioFactCheck>,
    pub work_id: WorkId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_instance_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_app_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub component_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_app_surface_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface_id: Option<String>,
    pub observed_at: i64,
    pub issue_count: usize,
    pub fatal_issue_count: usize,
    pub warning_issue_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkStudioValidationResult {
    pub id: String,
    pub tool_name: String,
    pub target_kind: WorkStudioValidationTargetKind,
    pub status: WorkStudioFactStatus,
    pub work_id: WorkId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub component_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub component_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_root: Option<String>,
    pub observed_at: i64,
    pub failed_count: usize,
    pub warning_count: usize,
    #[serde(default)]
    pub checks: Vec<WorkStudioFactCheck>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkStudioIssue {
    pub id: String,
    pub app_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_app_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub component_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_instance_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview_result_id: Option<String>,
    pub severity: WorkRuntimeIssueSeverity,
    #[serde(default = "default_studio_issue_status")]
    pub status: WorkStudioIssueStatus,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub timestamp_ms: i64,
    pub origin: WorkStudioIssueOrigin,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkArtifactNode {
    pub artifact: ArtifactRef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_instance_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkRuntimeInstanceGraph {
    pub instance: RuntimeInstanceRef,
    pub status: WorkRuntimeInstanceStatus,
    #[serde(default)]
    pub runs: Vec<WorkRuntimeRun>,
    #[serde(default)]
    pub issues: Vec<WorkRuntimeIssue>,
    #[serde(default)]
    pub logs: Vec<WorkRuntimeLog>,
    #[serde(default)]
    pub artifacts: Vec<WorkArtifactNode>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkExecutionGraphSummary {
    pub execution_count: usize,
    pub runtime_instance_count: usize,
    pub runtime_run_count: usize,
    pub artifact_count: usize,
    pub issue_count: usize,
    pub error_count: usize,
    pub warning_count: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_activity_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkExecutionGraph {
    pub work_id: WorkId,
    pub updated_at: i64,
    pub executions: Vec<WorkExecutionBinding>,
    pub runtime_instances: Vec<WorkRuntimeInstanceGraph>,
    pub artifacts: Vec<WorkArtifactNode>,
    #[serde(default)]
    pub issues: Vec<WorkRuntimeIssue>,
    #[serde(default)]
    pub logs: Vec<WorkRuntimeLog>,
    #[serde(default)]
    pub studio_preview_results: Vec<WorkStudioPreviewResult>,
    #[serde(default)]
    pub studio_validation_results: Vec<WorkStudioValidationResult>,
    #[serde(default)]
    pub studio_issues: Vec<WorkStudioIssue>,
    pub summary: WorkExecutionGraphSummary,
}

impl WorkExecutionGraph {
    pub fn from_parts(
        work_id: WorkId,
        updated_at: i64,
        executions: Vec<WorkExecutionBinding>,
        runtime_instances: Vec<RuntimeInstanceRef>,
        runtime_runs: Vec<WorkRuntimeRun>,
        issues: Vec<WorkRuntimeIssue>,
        logs: Vec<WorkRuntimeLog>,
        artifacts: Vec<WorkArtifactNode>,
        studio_preview_results: Vec<WorkStudioPreviewResult>,
        studio_validation_results: Vec<WorkStudioValidationResult>,
        studio_issues: Vec<WorkStudioIssue>,
    ) -> Self {
        let runtime_instance_graphs = runtime_instances
            .into_iter()
            .map(|instance| {
                let instance_runs: Vec<_> = runtime_runs
                    .iter()
                    .filter(|run| run.runtime_instance_id == instance.id)
                    .cloned()
                    .collect();
                let instance_issues: Vec<_> = issues
                    .iter()
                    .filter(|issue| issue.runtime_instance_id == instance.id)
                    .cloned()
                    .collect();
                let instance_logs: Vec<_> = logs
                    .iter()
                    .filter(|log| log.runtime_instance_id == instance.id)
                    .cloned()
                    .collect();
                let instance_artifacts: Vec<_> = artifacts
                    .iter()
                    .filter(|artifact| {
                        artifact.runtime_instance_id.as_deref() == Some(instance.id.as_str())
                    })
                    .cloned()
                    .collect();
                let status = derive_runtime_instance_status(
                    &instance_runs,
                    &instance_issues,
                    &instance_logs,
                );
                WorkRuntimeInstanceGraph {
                    instance,
                    status,
                    runs: instance_runs,
                    issues: instance_issues,
                    logs: instance_logs,
                    artifacts: instance_artifacts,
                }
            })
            .collect::<Vec<_>>();

        let mut last_activity_at = executions
            .iter()
            .map(|binding| binding.updated_at.max(binding.created_at))
            .chain(
                runtime_runs
                    .iter()
                    .map(|run| run.updated_at.max(run.started_at)),
            )
            .chain(issues.iter().map(|issue| issue.timestamp_ms))
            .chain(logs.iter().map(|log| log.timestamp_ms))
            .chain(
                studio_preview_results
                    .iter()
                    .map(|preview| preview.observed_at),
            )
            .chain(
                studio_validation_results
                    .iter()
                    .map(|validation| validation.observed_at),
            )
            .max();
        if last_activity_at.is_none() {
            last_activity_at = Some(updated_at);
        }

        let summary = WorkExecutionGraphSummary {
            execution_count: executions.len(),
            runtime_instance_count: runtime_instance_graphs.len(),
            runtime_run_count: runtime_runs.len(),
            artifact_count: artifacts.len(),
            issue_count: issues.len(),
            error_count: issues
                .iter()
                .filter(|issue| issue.severity == WorkRuntimeIssueSeverity::Fatal)
                .count()
                + logs
                    .iter()
                    .filter(|log| log.level == WorkRuntimeLogLevel::Error)
                    .count(),
            warning_count: issues
                .iter()
                .filter(|issue| issue.severity == WorkRuntimeIssueSeverity::Warning)
                .count()
                + logs
                    .iter()
                    .filter(|log| log.level == WorkRuntimeLogLevel::Warn)
                    .count(),
            last_activity_at,
        };

        Self {
            work_id,
            updated_at,
            executions,
            runtime_instances: runtime_instance_graphs,
            artifacts,
            issues,
            logs,
            studio_preview_results,
            studio_validation_results,
            studio_issues,
            summary,
        }
    }
}

fn default_studio_issue_status() -> WorkStudioIssueStatus {
    WorkStudioIssueStatus::Open
}

fn default_studio_preview_source() -> WorkStudioPreviewSource {
    WorkStudioPreviewSource::RuntimeFact
}

fn derive_runtime_instance_status(
    runs: &[WorkRuntimeRun],
    issues: &[WorkRuntimeIssue],
    logs: &[WorkRuntimeLog],
) -> WorkRuntimeInstanceStatus {
    if issues
        .iter()
        .any(|issue| issue.severity == WorkRuntimeIssueSeverity::Fatal)
        || logs
            .iter()
            .any(|log| log.level == WorkRuntimeLogLevel::Error)
        || runs
            .iter()
            .any(|run| run.status == WorkRuntimeRunStatus::Failed)
    {
        return WorkRuntimeInstanceStatus::Degraded;
    }
    if runs
        .iter()
        .any(|run| run.status == WorkRuntimeRunStatus::Running)
    {
        return WorkRuntimeInstanceStatus::Running;
    }
    if runs
        .iter()
        .any(|run| run.status == WorkRuntimeRunStatus::WaitingUser)
    {
        return WorkRuntimeInstanceStatus::WaitingUser;
    }
    if runs
        .iter()
        .any(|run| run.status == WorkRuntimeRunStatus::Completed)
    {
        return WorkRuntimeInstanceStatus::Completed;
    }
    WorkRuntimeInstanceStatus::Idle
}
