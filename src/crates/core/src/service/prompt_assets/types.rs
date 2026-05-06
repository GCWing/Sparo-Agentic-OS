use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PromptAssetKind {
    Agent,
    Mode,
    Snippet,
    Template,
}

impl Default for PromptAssetKind {
    fn default() -> Self {
        Self::Template
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PromptAssetScope {
    User,
    Workspace,
    Project,
}

impl Default for PromptAssetScope {
    fn default() -> Self {
        Self::Project
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PromptAssetStatus {
    Draft,
    Staging,
    Production,
    Archived,
}

impl Default for PromptAssetStatus {
    fn default() -> Self {
        Self::Draft
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptAssetMetadata {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    pub id: String,
    #[serde(default)]
    pub kind: PromptAssetKind,
    #[serde(default)]
    pub scope: PromptAssetScope,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub readonly: Option<bool>,
    #[serde(default)]
    pub tools: Vec<String>,
    #[serde(default)]
    pub status: PromptAssetStatus,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub source_history_event_id: Option<String>,
    #[serde(default)]
    pub source_session_id: Option<String>,
    #[serde(default)]
    pub source_turn_id: Option<String>,
}

fn default_schema_version() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptAsset {
    pub metadata: PromptAssetMetadata,
    pub body: String,
    pub relative_path: String,
    pub absolute_path: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptAssetSummary {
    pub id: String,
    pub kind: PromptAssetKind,
    pub scope: PromptAssetScope,
    pub name: String,
    pub description: Option<String>,
    pub status: PromptAssetStatus,
    pub version: Option<String>,
    pub tags: Vec<String>,
    pub source_history_event_id: Option<String>,
    pub source_session_id: Option<String>,
    pub source_turn_id: Option<String>,
    pub relative_path: String,
    pub content_hash: String,
}

impl From<&PromptAsset> for PromptAssetSummary {
    fn from(asset: &PromptAsset) -> Self {
        Self {
            id: asset.metadata.id.clone(),
            kind: asset.metadata.kind,
            scope: asset.metadata.scope,
            name: asset.metadata.name.clone(),
            description: asset.metadata.description.clone(),
            status: asset.metadata.status,
            version: asset.metadata.version.clone(),
            tags: asset.metadata.tags.clone(),
            source_history_event_id: asset.metadata.source_history_event_id.clone(),
            source_session_id: asset.metadata.source_session_id.clone(),
            source_turn_id: asset.metadata.source_turn_id.clone(),
            relative_path: asset.relative_path.clone(),
            content_hash: asset.content_hash.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PromptValidationSeverity {
    Error,
    Warning,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptValidationIssue {
    pub severity: PromptValidationSeverity,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptValidationReport {
    pub valid: bool,
    pub issues: Vec<PromptValidationIssue>,
}

impl PromptValidationReport {
    pub fn new(issues: Vec<PromptValidationIssue>) -> Self {
        let valid = !issues
            .iter()
            .any(|issue| matches!(issue.severity, PromptValidationSeverity::Error));
        Self { valid, issues }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptAssetGitStatus {
    pub is_git_repository: bool,
    pub prompt_root: String,
    pub entries: Vec<PromptAssetGitStatusEntry>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptAssetGitStatusEntry {
    pub path: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptAssetGitCommit {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub date: String,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptAssetGitDiff {
    pub is_git_repository: bool,
    pub relative_path: String,
    pub diff: String,
    pub message: Option<String>,
}
