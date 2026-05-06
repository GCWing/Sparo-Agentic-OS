use super::types::{
    PromptLlmAssessment, PromptLlmAssessmentStatus, PromptValueConfidence, PromptValueRecord,
    PromptValueSignal, PromptValueSignalInput, PromptValueSignalKind, PromptValueTier,
};
use crate::infrastructure::get_path_manager_arc;
use crate::service::prompt_assets::PromptAssetSummary;
use crate::service::prompt_commit_trace::GitPromptHistoryCommit;
use crate::service::prompt_history::{PromptHistoryEvent, PromptHistorySource};
use crate::util::errors::{BitFunError, BitFunResult};
use chrono::Utc;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use uuid::Uuid;

const PROMPT_VALUE_DIR: &str = "prompt_value";
const PROMPT_VALUE_SIGNALS_FILE: &str = "signals.jsonl";
const PROMPT_LLM_ASSESSMENTS_DIR: &str = "llm_assessments";

pub struct PromptValueStore;

impl PromptValueStore {
    pub fn value_dir(workspace_path: &Path) -> PathBuf {
        get_path_manager_arc()
            .project_runtime_root(workspace_path)
            .join(PROMPT_VALUE_DIR)
    }

    pub fn signals_file(workspace_path: &Path) -> PathBuf {
        Self::value_dir(workspace_path).join(PROMPT_VALUE_SIGNALS_FILE)
    }

    pub fn llm_assessments_dir(workspace_path: &Path) -> PathBuf {
        Self::value_dir(workspace_path).join(PROMPT_LLM_ASSESSMENTS_DIR)
    }

    pub fn llm_assessment_file(workspace_path: &Path, event_id: &str) -> BitFunResult<PathBuf> {
        Ok(Self::llm_assessments_dir(workspace_path)
            .join(format!("{}.json", safe_event_file_stem(event_id)?)))
    }

    pub fn record_prompt_created(
        workspace_path: &Path,
        event: &PromptHistoryEvent,
    ) -> BitFunResult<PromptValueSignal> {
        Self::record_signal(
            workspace_path,
            PromptValueSignalInput {
                prompt_history_event_id: Some(event.id.clone()),
                prompt_hash: Some(event.prompt_hash.clone()),
                session_id: Some(event.session_id.clone()),
                turn_id: event.turn_id.clone(),
                kind: PromptValueSignalKind::PromptCreated,
                weight: Some(20),
                confidence: Some(PromptValueConfidence::Low),
                reason: Some("Prompt history event recorded".to_string()),
                metadata: Some(json!({
                    "source": event.source,
                    "agentType": event.agent_type,
                })),
            },
        )
    }

    pub fn record_saved_as_asset(
        workspace_path: &Path,
        event: &PromptHistoryEvent,
        asset: &PromptAssetSummary,
    ) -> BitFunResult<PromptValueSignal> {
        Self::record_signal(
            workspace_path,
            PromptValueSignalInput {
                prompt_history_event_id: Some(event.id.clone()),
                prompt_hash: Some(event.prompt_hash.clone()),
                session_id: Some(event.session_id.clone()),
                turn_id: event.turn_id.clone(),
                kind: PromptValueSignalKind::SavedAsAsset,
                weight: Some(35),
                confidence: Some(PromptValueConfidence::High),
                reason: Some(format!("Saved as prompt asset: {}", asset.name)),
                metadata: Some(json!({
                    "assetId": asset.id,
                    "assetName": asset.name,
                    "assetStatus": asset.status,
                    "assetScope": asset.scope,
                })),
            },
        )
    }

    pub fn record_signal(
        workspace_path: &Path,
        input: PromptValueSignalInput,
    ) -> BitFunResult<PromptValueSignal> {
        if input.prompt_history_event_id.is_none()
            && input.prompt_hash.is_none()
            && input.turn_id.is_none()
        {
            return Err(BitFunError::validation(
                "Prompt value signal must identify a prompt history event, prompt hash, or turn",
            ));
        }
        let signal = PromptValueSignal {
            id: format!("signal_{}", Uuid::new_v4().simple()),
            prompt_history_event_id: input.prompt_history_event_id,
            prompt_hash: input.prompt_hash,
            session_id: input.session_id,
            turn_id: input.turn_id,
            kind: input.kind,
            weight: input.weight.unwrap_or_else(|| default_weight(input.kind)),
            confidence: input
                .confidence
                .unwrap_or_else(|| default_confidence(input.kind)),
            reason: input.reason.unwrap_or_else(|| default_reason(input.kind)),
            created_at: Utc::now().to_rfc3339(),
            metadata: input.metadata,
        };
        Self::append_signal(workspace_path, &signal)?;
        Ok(signal)
    }

    pub fn list_signals(workspace_path: &Path) -> BitFunResult<Vec<PromptValueSignal>> {
        let file = Self::signals_file(workspace_path);
        if !file.exists() {
            return Ok(Vec::new());
        }
        let mut signals = Vec::new();
        for line in BufReader::new(fs::File::open(file)?).lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<PromptValueSignal>(&line) {
                Ok(signal) => signals.push(signal),
                Err(error) => log::warn!("Failed to parse prompt value signal: {}", error),
            }
        }
        Ok(signals)
    }

    pub fn list_records(
        workspace_path: &Path,
        history: &[PromptHistoryEvent],
        assets: &[PromptAssetSummary],
        git_commits: &[GitPromptHistoryCommit],
    ) -> BitFunResult<Vec<PromptValueRecord>> {
        let mut events_by_id = HashMap::<String, PromptHistoryEvent>::new();
        for event in history {
            events_by_id.insert(event.id.clone(), event.clone());
        }
        for commit in git_commits {
            for prompt in &commit.prompts {
                events_by_id.insert(prompt.id.clone(), prompt.clone());
            }
        }

        let mut reuse_counts = HashMap::<String, usize>::new();
        for event in events_by_id.values() {
            *reuse_counts.entry(event.prompt_hash.clone()).or_default() += 1;
        }

        let mut signals_by_event_id = HashMap::<String, Vec<PromptValueSignal>>::new();
        let mut signals_by_prompt_hash = HashMap::<String, Vec<PromptValueSignal>>::new();
        let mut signals_by_turn_id = HashMap::<String, Vec<PromptValueSignal>>::new();
        for signal in Self::list_signals(workspace_path)? {
            if let Some(id) = &signal.prompt_history_event_id {
                signals_by_event_id
                    .entry(id.clone())
                    .or_default()
                    .push(signal.clone());
            }
            if signal.prompt_history_event_id.is_none() {
                if let Some(hash) = &signal.prompt_hash {
                    signals_by_prompt_hash
                        .entry(hash.clone())
                        .or_default()
                        .push(signal.clone());
                }
            }
            if let Some(turn_id) = &signal.turn_id {
                signals_by_turn_id
                    .entry(turn_id.clone())
                    .or_default()
                    .push(signal.clone());
            }
        }

        let mut asset_signals_by_event_id = HashMap::<String, Vec<PromptValueSignal>>::new();
        for asset in assets {
            let Some(event_id) = asset.source_history_event_id.as_ref() else {
                continue;
            };
            if let Some(event) = events_by_id.get(event_id) {
                asset_signals_by_event_id
                    .entry(event_id.clone())
                    .or_default()
                    .push(derived_signal(
                        event,
                        PromptValueSignalKind::SavedAsAsset,
                        35,
                        PromptValueConfidence::High,
                        format!("Saved as prompt asset: {}", asset.name),
                        Some(json!({
                            "assetId": asset.id,
                            "assetName": asset.name,
                            "assetStatus": asset.status,
                            "assetScope": asset.scope,
                        })),
                    ));
            }
        }

        let mut commit_signals_by_event_id = HashMap::<String, Vec<PromptValueSignal>>::new();
        for commit in git_commits {
            let source =
                commit.trace.as_ref().map(|trace| trace.source).unwrap_or(
                    crate::service::prompt_commit_trace::PromptCommitLinkSource::TimeWindow,
                );
            let weight = match source {
                crate::service::prompt_commit_trace::PromptCommitLinkSource::HeadMarker => 14,
                crate::service::prompt_commit_trace::PromptCommitLinkSource::TimeWindow => 10,
            };
            for prompt in &commit.prompts {
                commit_signals_by_event_id
                    .entry(prompt.id.clone())
                    .or_default()
                    .push(derived_signal(
                        prompt,
                        PromptValueSignalKind::CommitWindow,
                        weight,
                        PromptValueConfidence::Low,
                        format!(
                            "Appears in commit prompt window: {} {}",
                            commit.short_hash, commit.subject
                        ),
                        Some(json!({
                            "commitHash": commit.hash,
                            "shortHash": commit.short_hash,
                            "subject": commit.subject,
                            "source": source,
                        })),
                    ));
            }
        }

        let mut records = Vec::new();
        for event in events_by_id.values() {
            let mut signals = Vec::new();
            if let Some(items) = signals_by_event_id.get(&event.id) {
                signals.extend(items.clone());
            }
            if let Some(items) = signals_by_prompt_hash.get(&event.prompt_hash) {
                signals.extend(
                    items
                        .iter()
                        .filter(|signal| {
                            signal.prompt_history_event_id.as_deref() != Some(&event.id)
                        })
                        .cloned(),
                );
            }
            if let Some(turn_id) = event.turn_id.as_ref() {
                if let Some(items) = signals_by_turn_id.get(turn_id) {
                    signals.extend(
                        items
                            .iter()
                            .filter(|signal| {
                                signal.prompt_history_event_id.as_deref() != Some(&event.id)
                            })
                            .cloned(),
                    );
                }
            }
            if let Some(items) = asset_signals_by_event_id.get(&event.id) {
                signals.extend(items.clone());
            }
            if let Some(items) = commit_signals_by_event_id.get(&event.id) {
                signals.extend(items.clone());
            }
            signals.extend(heuristic_signals(event));
            dedupe_signals(&mut signals);

            let mut record = build_record(
                event,
                reuse_counts.get(&event.prompt_hash).copied().unwrap_or(1),
                signals,
            );
            if let Ok(Some(assessment)) = Self::get_llm_assessment(workspace_path, &event.id) {
                if assessment.input_hash == Self::llm_assessment_input_hash(event, &record)? {
                    record.llm_assessment = Some(assessment);
                }
            }
            records.push(record);
        }
        records.sort_by(|a, b| b.score.cmp(&a.score).then(b.updated_at.cmp(&a.updated_at)));
        Ok(records)
    }

    pub fn get_llm_assessment(
        workspace_path: &Path,
        event_id: &str,
    ) -> BitFunResult<Option<PromptLlmAssessment>> {
        let file = Self::llm_assessment_file(workspace_path, event_id)?;
        if !file.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(file)?;
        Ok(Some(serde_json::from_str(&content)?))
    }

    pub fn save_llm_assessment(
        workspace_path: &Path,
        assessment: &PromptLlmAssessment,
    ) -> BitFunResult<()> {
        let dir = Self::llm_assessments_dir(workspace_path);
        fs::create_dir_all(&dir)?;
        let file = Self::llm_assessment_file(workspace_path, &assessment.prompt_history_event_id)?;
        let content = serde_json::to_string_pretty(assessment)?;
        fs::write(file, format!("{content}\n"))?;
        Ok(())
    }

    pub fn llm_assessment_input_hash(
        event: &PromptHistoryEvent,
        record: &PromptValueRecord,
    ) -> BitFunResult<String> {
        let signal_fingerprint = record
            .signals
            .iter()
            .map(|signal| {
                json!({
                    "kind": signal.kind,
                    "weight": signal.weight,
                    "confidence": signal.confidence,
                    "reason": &signal.reason,
                    "metadata": &signal.metadata,
                })
            })
            .collect::<Vec<_>>();
        let payload = json!({
            "schemaVersion": 1,
            "promptHistoryEventId": &event.id,
            "promptHash": &event.prompt_hash,
            "source": event.source,
            "agentType": &event.agent_type,
            "pinned": event.pinned,
            "imageContextCount": event.context.as_ref().map(|context| context.runtime.image_context_count).unwrap_or(0),
            "score": record.score,
            "tier": record.tier,
            "confidence": record.confidence,
            "reuseCount": record.reuse_count,
            "reasons": &record.reasons,
            "warnings": &record.warnings,
            "signals": signal_fingerprint,
        });
        let bytes = serde_json::to_vec(&payload)?;
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        Ok(hex::encode(hasher.finalize()))
    }

    pub fn new_llm_assessment(
        event: &PromptHistoryEvent,
        record: &PromptValueRecord,
        status: PromptLlmAssessmentStatus,
        model: Option<String>,
    ) -> BitFunResult<PromptLlmAssessment> {
        Ok(PromptLlmAssessment {
            prompt_history_event_id: event.id.clone(),
            prompt_hash: event.prompt_hash.clone(),
            deterministic_score: record.score,
            input_hash: Self::llm_assessment_input_hash(event, record)?,
            status,
            attempts: 0,
            requested_at: Utc::now().to_rfc3339(),
            completed_at: None,
            model,
            language_code: None,
            llm_score: None,
            confidence: None,
            impact_summary: None,
            quality_findings: Vec::new(),
            risk_findings: Vec::new(),
            recommended_action: None,
            suggested_tags: Vec::new(),
            template_potential: None,
            rationale: Vec::new(),
            error: None,
        })
    }

    fn append_signal(workspace_path: &Path, signal: &PromptValueSignal) -> BitFunResult<()> {
        let dir = Self::value_dir(workspace_path);
        fs::create_dir_all(&dir)?;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join(PROMPT_VALUE_SIGNALS_FILE))?;
        let line = serde_json::to_string(signal)?;
        writeln!(file, "{line}")?;
        Ok(())
    }
}

fn build_record(
    event: &PromptHistoryEvent,
    reuse_count: usize,
    mut signals: Vec<PromptValueSignal>,
) -> PromptValueRecord {
    let mut score = signals.iter().map(|signal| signal.weight).sum::<i32>();
    let mut reasons = Vec::new();
    let mut warnings = Vec::new();

    if reuse_count >= 5 {
        score += 24;
        reasons.push(format!("Same prompt hash appears {} times.", reuse_count));
    } else if reuse_count >= 3 {
        score += 18;
        reasons.push(format!("Same prompt hash appears {} times.", reuse_count));
    } else if reuse_count >= 2 {
        score += 11;
        reasons.push(format!("Same prompt hash appears {} times.", reuse_count));
    }

    for signal in &signals {
        match signal.kind {
            PromptValueSignalKind::TurnFailed
            | PromptValueSignalKind::TurnCancelled
            | PromptValueSignalKind::Retry
            | PromptValueSignalKind::ToolFailed
            | PromptValueSignalKind::Rollback
            | PromptValueSignalKind::CorrectionPrompt => warnings.push(signal.reason.clone()),
            PromptValueSignalKind::CommitWindow => {
                reasons.push(signal.reason.clone());
            }
            _ => reasons.push(signal.reason.clone()),
        }
    }
    dedupe_strings(&mut reasons);
    dedupe_strings(&mut warnings);
    if reasons.is_empty() && warnings.is_empty() {
        reasons.push("No strong value signal detected yet.".to_string());
    }

    let score = score.clamp(0, 100) as u32;
    let has_strong_signal = signals.iter().any(|signal| {
        matches!(
            signal.kind,
            PromptValueSignalKind::SavedAsAsset
                | PromptValueSignalKind::UserPinned
                | PromptValueSignalKind::UserFeedback
                | PromptValueSignalKind::TurnCompleted
        )
    }) || reuse_count >= 2;
    let has_commit_context = signals
        .iter()
        .any(|signal| matches!(signal.kind, PromptValueSignalKind::CommitWindow));
    let confidence = prompt_value_confidence(&signals, score, has_strong_signal);
    let tier = prompt_value_tier(
        score,
        has_strong_signal,
        has_commit_context,
        !warnings.is_empty(),
    );
    signals.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    PromptValueRecord {
        prompt_history_event_id: event.id.clone(),
        prompt_hash: event.prompt_hash.clone(),
        session_id: event.session_id.clone(),
        turn_id: event.turn_id.clone(),
        score,
        tier,
        confidence,
        llm_assessment: None,
        reuse_count,
        reasons,
        warnings,
        signals,
        updated_at: Utc::now().to_rfc3339(),
    }
}

fn prompt_value_tier(
    score: u32,
    has_strong_signal: bool,
    has_commit_context: bool,
    has_warning: bool,
) -> PromptValueTier {
    if score < 20 && has_warning {
        return PromptValueTier::Risk;
    }
    if score >= 80 {
        return PromptValueTier::Excellent;
    }
    if score >= 65 {
        return PromptValueTier::High;
    }
    if score >= 45 {
        return PromptValueTier::Potential;
    }
    if has_commit_context && !has_strong_signal {
        return PromptValueTier::Context;
    }
    if score < 25 && has_warning {
        return PromptValueTier::Risk;
    }
    PromptValueTier::Normal
}

fn prompt_value_confidence(
    signals: &[PromptValueSignal],
    score: u32,
    has_strong_signal: bool,
) -> PromptValueConfidence {
    if signals
        .iter()
        .any(|signal| matches!(signal.confidence, PromptValueConfidence::High))
    {
        return PromptValueConfidence::High;
    }
    if has_strong_signal || score >= 55 {
        return PromptValueConfidence::Medium;
    }
    PromptValueConfidence::Low
}

fn heuristic_signals(event: &PromptHistoryEvent) -> Vec<PromptValueSignal> {
    let mut signals = Vec::new();
    let text = event.text.trim();
    if has_prompt_structure(text) {
        signals.push(derived_signal(
            event,
            PromptValueSignalKind::StructuredPrompt,
            8,
            PromptValueConfidence::Low,
            "Contains structured task cues".to_string(),
            None,
        ));
    }
    if event
        .context
        .as_ref()
        .is_some_and(|context| context.runtime.image_context_count > 0)
    {
        signals.push(derived_signal(
            event,
            PromptValueSignalKind::ImageContext,
            4,
            PromptValueConfidence::Low,
            "Includes image context".to_string(),
            None,
        ));
    }
    if matches!(event.source, PromptHistorySource::Retry) {
        signals.push(derived_signal(
            event,
            PromptValueSignalKind::Retry,
            -18,
            PromptValueConfidence::Medium,
            "Recorded from a retry".to_string(),
            None,
        ));
    }
    if looks_like_correction_prompt(text) {
        signals.push(derived_signal(
            event,
            PromptValueSignalKind::CorrectionPrompt,
            -10,
            PromptValueConfidence::Low,
            "Looks like a correction or rework prompt".to_string(),
            None,
        ));
    }
    if text.len() < 40 {
        signals.push(derived_signal(
            event,
            PromptValueSignalKind::StructuredPrompt,
            -8,
            PromptValueConfidence::Low,
            "Very short prompt; value is hard to infer".to_string(),
            None,
        ));
    }
    signals
}

fn derived_signal(
    event: &PromptHistoryEvent,
    kind: PromptValueSignalKind,
    weight: i32,
    confidence: PromptValueConfidence,
    reason: String,
    metadata: Option<serde_json::Value>,
) -> PromptValueSignal {
    PromptValueSignal {
        id: format!("derived_{}_{}", event.id, kind_key(kind)),
        prompt_history_event_id: Some(event.id.clone()),
        prompt_hash: Some(event.prompt_hash.clone()),
        session_id: Some(event.session_id.clone()),
        turn_id: event.turn_id.clone(),
        kind,
        weight,
        confidence,
        reason,
        created_at: Utc::now().to_rfc3339(),
        metadata,
    }
}

fn default_weight(kind: PromptValueSignalKind) -> i32 {
    match kind {
        PromptValueSignalKind::PromptCreated => 20,
        PromptValueSignalKind::TurnCompleted => 15,
        PromptValueSignalKind::TurnFailed => -25,
        PromptValueSignalKind::TurnCancelled => -18,
        PromptValueSignalKind::Retry => -18,
        PromptValueSignalKind::SavedAsAsset => 35,
        PromptValueSignalKind::AssetUsed => 18,
        PromptValueSignalKind::UserPinned => 25,
        PromptValueSignalKind::UserFeedback => 20,
        PromptValueSignalKind::ToolSucceeded => 4,
        PromptValueSignalKind::ToolFailed => -8,
        PromptValueSignalKind::Rollback => -30,
        PromptValueSignalKind::CommitWindow => 10,
        PromptValueSignalKind::StructuredPrompt => 8,
        PromptValueSignalKind::CorrectionPrompt => -10,
        PromptValueSignalKind::ImageContext => 4,
    }
}

fn default_confidence(kind: PromptValueSignalKind) -> PromptValueConfidence {
    match kind {
        PromptValueSignalKind::SavedAsAsset
        | PromptValueSignalKind::UserPinned
        | PromptValueSignalKind::UserFeedback => PromptValueConfidence::High,
        PromptValueSignalKind::TurnCompleted
        | PromptValueSignalKind::TurnFailed
        | PromptValueSignalKind::TurnCancelled
        | PromptValueSignalKind::Retry
        | PromptValueSignalKind::Rollback => PromptValueConfidence::Medium,
        _ => PromptValueConfidence::Low,
    }
}

fn default_reason(kind: PromptValueSignalKind) -> String {
    format!("{:?}", kind)
}

fn has_prompt_structure(text: &str) -> bool {
    let line_count = text.lines().filter(|line| !line.trim().is_empty()).count();
    let lower = text.to_lowercase();
    line_count >= 4
        || [
            "目标",
            "要求",
            "约束",
            "输出",
            "验收",
            "步骤",
            "背景",
            "plan",
            "steps",
            "requirements",
            "constraints",
            "acceptance",
            "output",
            "goal",
            "context",
        ]
        .iter()
        .any(|marker| lower.contains(marker))
}

fn looks_like_correction_prompt(text: &str) -> bool {
    let lower = text.to_lowercase();
    [
        "不是",
        "不对",
        "重做",
        "重新来",
        "你理解错",
        "修复刚才",
        "刚才的问题",
        "wrong",
        "not what i meant",
        "redo",
        "try again",
        "fix the previous",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

fn dedupe_strings(values: &mut Vec<String>) {
    let mut seen = std::collections::HashSet::new();
    values.retain(|value| seen.insert(value.clone()));
}

fn dedupe_signals(values: &mut Vec<PromptValueSignal>) {
    let mut seen = std::collections::HashSet::new();
    values.retain(|value| {
        let key = format!(
            "{}:{:?}:{}:{}",
            value.prompt_history_event_id.as_deref().unwrap_or(""),
            value.kind,
            value.reason,
            value
                .metadata
                .as_ref()
                .map(|metadata| metadata.to_string())
                .unwrap_or_default()
        );
        seen.insert(key)
    });
}

fn safe_event_file_stem(event_id: &str) -> BitFunResult<&str> {
    let trimmed = event_id.trim();
    if trimmed.is_empty()
        || !trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return Err(BitFunError::validation(
            "Prompt history event ID is invalid",
        ));
    }
    Ok(trimmed)
}

fn kind_key(kind: PromptValueSignalKind) -> &'static str {
    match kind {
        PromptValueSignalKind::PromptCreated => "prompt_created",
        PromptValueSignalKind::TurnCompleted => "turn_completed",
        PromptValueSignalKind::TurnFailed => "turn_failed",
        PromptValueSignalKind::TurnCancelled => "turn_cancelled",
        PromptValueSignalKind::Retry => "retry",
        PromptValueSignalKind::SavedAsAsset => "saved_as_asset",
        PromptValueSignalKind::AssetUsed => "asset_used",
        PromptValueSignalKind::UserPinned => "user_pinned",
        PromptValueSignalKind::UserFeedback => "user_feedback",
        PromptValueSignalKind::ToolSucceeded => "tool_succeeded",
        PromptValueSignalKind::ToolFailed => "tool_failed",
        PromptValueSignalKind::Rollback => "rollback",
        PromptValueSignalKind::CommitWindow => "commit_window",
        PromptValueSignalKind::StructuredPrompt => "structured_prompt",
        PromptValueSignalKind::CorrectionPrompt => "correction_prompt",
        PromptValueSignalKind::ImageContext => "image_context",
    }
}
