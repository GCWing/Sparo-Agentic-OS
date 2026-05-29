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

/// Structured dimensions for composing prompt assets.
/// Users fill in role, context, goal, boundaries, rules, and examples
/// to produce well-structured reusable prompts.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptDimensions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goal: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub boundaries: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rules: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub examples: Option<String>,
}

impl PromptDimensions {
    pub fn is_empty(&self) -> bool {
        self.role.is_none()
            && self.context.is_none()
            && self.goal.is_none()
            && self.boundaries.is_none()
            && self.rules.is_none()
            && self.examples.is_none()
    }
}

/// Predefined task-template types that offer guided dimension
/// scaffolds for common prompt workflows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PromptTemplateType {
    Custom,
    CodeReview,
    BugFix,
    FeatureDesign,
    Refactor,
    Testing,
    Documentation,
    Architecture,
    General,
}

impl Default for PromptTemplateType {
    fn default() -> Self {
        Self::Custom
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
    #[serde(default, skip_serializing_if = "PromptDimensions::is_empty")]
    pub dimensions: PromptDimensions,
    #[serde(default)]
    pub template_type: PromptTemplateType,
}

fn default_schema_version() -> u32 {
    2
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
    pub template_type: PromptTemplateType,
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
            template_type: asset.metadata.template_type,
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
