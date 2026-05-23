//! Context budget statistics.
//!
//! This module estimates the model-visible input budget before a provider call.
//! Provider usage remains a separate ledger; these snapshots are for explaining
//! what Sparo is about to place in the context window.

use crate::agentic::core::is_system_reminder_only;
use crate::util::token_counter::TokenCounter;
use crate::util::types::{Message as AIMessage, ToolDefinition};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextBudgetSnapshot {
    pub id: String,
    pub kind: ContextSnapshotKind,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub round_id: Option<String>,
    pub agent_type: String,
    pub model_id: String,
    pub provider: String,
    pub context_window: usize,
    pub totals: ContextBudgetTotals,
    pub estimation: ContextBudgetEstimation,
    pub segments: Vec<ContextSegment>,
    pub created_at: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextSnapshotKind {
    Static,
    Request,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextBudgetTotals {
    pub input_tokens: usize,
    pub reserved_output_tokens: usize,
    pub remaining_tokens: usize,
    pub used_ratio: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextBudgetEstimation {
    pub algorithm: String,
    pub confidence: ContextEstimateConfidence,
    pub calibrated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calibration_profile_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextEstimateConfidence {
    High,
    Approx,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSegment {
    pub id: String,
    pub kind: ContextSegmentKind,
    pub label: String,
    pub tokens: usize,
    pub percent: f64,
    pub source: ContextSegmentSource,
    pub properties: ContextSegmentProperties,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<ContextSegment>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ContextSegmentKind {
    SystemPrompt,
    Environment,
    WorkspaceInstructions,
    Memory,
    FilesContext,
    ToolSchemas,
    SkillCatalog,
    SubagentCatalog,
    ConversationHistory,
    CurrentUserMessage,
    AssistantHistory,
    ToolResults,
    Images,
    CompressionSummary,
    ProviderOverhead,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSegmentSource {
    #[serde(rename = "type")]
    pub source_type: ContextSegmentSourceType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextSegmentSourceType {
    Agent,
    Tool,
    Skill,
    Subagent,
    Message,
    System,
    Runtime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSegmentProperties {
    pub static_part: bool,
    pub cacheable: bool,
    pub compressible: bool,
    pub user_visible: bool,
}

pub struct ContextStatsEstimator;

impl ContextStatsEstimator {
    pub fn static_snapshot(
        session_id: impl Into<String>,
        agent_type: impl Into<String>,
        model_id: impl Into<String>,
        provider: impl Into<String>,
        context_window: usize,
        system_prompt: &str,
        request_context: Option<&str>,
        tools: Option<&[ToolDefinition]>,
    ) -> ContextBudgetSnapshot {
        let mut segments = Vec::new();
        push_text_segment(
            &mut segments,
            ContextSegmentKind::SystemPrompt,
            "System prompt",
            system_prompt,
            ContextSegmentSourceType::Agent,
            None,
            None,
            true,
            false,
            false,
        );
        if let Some(request_context) = request_context {
            push_text_segment(
                &mut segments,
                ContextSegmentKind::WorkspaceInstructions,
                "Workspace context",
                request_context,
                ContextSegmentSourceType::System,
                None,
                None,
                true,
                true,
                false,
            );
        }
        append_tool_segments(&mut segments, tools);
        finish_snapshot(
            ContextSnapshotKind::Static,
            session_id.into(),
            None,
            None,
            agent_type.into(),
            model_id.into(),
            provider.into(),
            context_window,
            segments,
        )
    }

    pub fn request_snapshot(
        session_id: impl Into<String>,
        turn_id: impl Into<String>,
        round_id: impl Into<String>,
        agent_type: impl Into<String>,
        model_id: impl Into<String>,
        provider: impl Into<String>,
        context_window: usize,
        ai_messages: &[AIMessage],
        tools: Option<&[ToolDefinition]>,
    ) -> ContextBudgetSnapshot {
        let mut segments = Vec::new();
        append_message_segments(&mut segments, ai_messages);
        append_tool_segments(&mut segments, tools);
        finish_snapshot(
            ContextSnapshotKind::Request,
            session_id.into(),
            Some(turn_id.into()),
            Some(round_id.into()),
            agent_type.into(),
            model_id.into(),
            provider.into(),
            context_window,
            segments,
        )
    }
}

fn append_message_segments(segments: &mut Vec<ContextSegment>, messages: &[AIMessage]) {
    for (index, message) in messages.iter().enumerate() {
        let content = message.content.as_deref().unwrap_or_default();
        let kind = match message.role.as_str() {
            "system" => ContextSegmentKind::SystemPrompt,
            "tool" => ContextSegmentKind::ToolResults,
            "assistant" => ContextSegmentKind::AssistantHistory,
            "user" if is_system_reminder_only(content) => ContextSegmentKind::WorkspaceInstructions,
            "user" if index == messages.len().saturating_sub(1) => {
                ContextSegmentKind::CurrentUserMessage
            }
            "user" => ContextSegmentKind::ConversationHistory,
            _ => ContextSegmentKind::ConversationHistory,
        };
        let label = match kind {
            ContextSegmentKind::SystemPrompt => "System prompt",
            ContextSegmentKind::WorkspaceInstructions => "Workspace context",
            ContextSegmentKind::ToolResults => "Tool results",
            ContextSegmentKind::AssistantHistory => "Assistant history",
            ContextSegmentKind::CurrentUserMessage => "Current message",
            _ => "Conversation",
        };
        let tokens = TokenCounter::estimate_message_tokens(message);
        push_segment(
            segments,
            kind,
            label,
            tokens,
            ContextSegmentSourceType::Message,
            None,
            None,
            matches!(
                kind,
                ContextSegmentKind::SystemPrompt | ContextSegmentKind::WorkspaceInstructions
            ),
            !matches!(kind, ContextSegmentKind::SystemPrompt),
            false,
        );
    }
}

fn append_tool_segments(segments: &mut Vec<ContextSegment>, tools: Option<&[ToolDefinition]>) {
    let Some(tools) = tools else {
        return;
    };

    for tool in tools {
        let kind = match tool.name.as_str() {
            "Skill" => ContextSegmentKind::SkillCatalog,
            "Task" => ContextSegmentKind::SubagentCatalog,
            _ => ContextSegmentKind::ToolSchemas,
        };
        let label = match kind {
            ContextSegmentKind::SkillCatalog => "Skills",
            ContextSegmentKind::SubagentCatalog => "Subagents",
            _ => "Tools",
        };
        let tokens = TokenCounter::estimate_tool_definitions_tokens(std::slice::from_ref(tool));
        push_segment(
            segments,
            kind,
            label,
            tokens,
            match kind {
                ContextSegmentKind::SkillCatalog => ContextSegmentSourceType::Skill,
                ContextSegmentKind::SubagentCatalog => ContextSegmentSourceType::Subagent,
                _ => ContextSegmentSourceType::Tool,
            },
            Some(tool.name.clone()),
            Some(tool.name.clone()),
            true,
            true,
            false,
        );
    }
}

#[allow(clippy::too_many_arguments)]
fn push_text_segment(
    segments: &mut Vec<ContextSegment>,
    kind: ContextSegmentKind,
    label: &str,
    text: &str,
    source_type: ContextSegmentSourceType,
    id: Option<String>,
    name: Option<String>,
    static_part: bool,
    cacheable: bool,
    user_visible: bool,
) {
    let tokens = TokenCounter::estimate_tokens(text);
    push_segment(
        segments,
        kind,
        label,
        tokens,
        source_type,
        id,
        name,
        static_part,
        cacheable,
        user_visible,
    );
}

#[allow(clippy::too_many_arguments)]
fn push_segment(
    segments: &mut Vec<ContextSegment>,
    kind: ContextSegmentKind,
    label: &str,
    tokens: usize,
    source_type: ContextSegmentSourceType,
    id: Option<String>,
    name: Option<String>,
    static_part: bool,
    cacheable: bool,
    user_visible: bool,
) {
    if tokens == 0 {
        return;
    }
    segments.push(ContextSegment {
        id: uuid::Uuid::new_v4().to_string(),
        kind,
        label: label.to_string(),
        tokens,
        percent: 0.0,
        source: ContextSegmentSource {
            source_type,
            id,
            name,
        },
        properties: ContextSegmentProperties {
            static_part,
            cacheable,
            compressible: !static_part,
            user_visible,
        },
        children: Vec::new(),
    });
}

fn finish_snapshot(
    kind: ContextSnapshotKind,
    session_id: String,
    turn_id: Option<String>,
    round_id: Option<String>,
    agent_type: String,
    model_id: String,
    provider: String,
    context_window: usize,
    mut segments: Vec<ContextSegment>,
) -> ContextBudgetSnapshot {
    let input_tokens = segments.iter().map(|segment| segment.tokens).sum::<usize>();
    let percent_denominator = if context_window > 0 {
        context_window
    } else {
        input_tokens.max(1)
    } as f64;
    for segment in &mut segments {
        segment.percent = (segment.tokens as f64 / percent_denominator) * 100.0;
    }
    let remaining_tokens = context_window.saturating_sub(input_tokens);
    ContextBudgetSnapshot {
        id: uuid::Uuid::new_v4().to_string(),
        kind,
        session_id,
        turn_id,
        round_id,
        agent_type,
        model_id,
        provider,
        context_window,
        totals: ContextBudgetTotals {
            input_tokens,
            reserved_output_tokens: 0,
            remaining_tokens,
            used_ratio: if context_window == 0 {
                0.0
            } else {
                input_tokens as f64 / context_window as f64
            },
        },
        estimation: ContextBudgetEstimation {
            algorithm: "sparo_builtin_estimator".to_string(),
            confidence: ContextEstimateConfidence::Approx,
            calibrated: false,
            calibration_profile_id: None,
        },
        segments,
        created_at: chrono::Utc::now().timestamp_millis() as u64,
    }
}
