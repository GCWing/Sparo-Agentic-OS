//! Platform-agnostic Markdown co-author prompt and proposal normalization.
//!
//! Desktop commands own transport and event emission; this module owns the
//! ephemeral co-author business contract that is shared by app surfaces.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentProfile {
    pub purpose: Option<String>,
    pub audience: Option<String>,
    pub tone: Option<String>,
    pub length: Option<String>,
    pub forbidden_words: Option<Vec<String>>,
    pub language: Option<String>,
}

#[derive(Debug, Clone)]
pub struct EditorCoauthorPromptRequest {
    pub request_id: String,
    pub action_id: String,
    pub scope: String,
    pub intent: String,
    pub file_path: Option<String>,
    pub source_hash: String,
    pub document_markdown: String,
    pub target: Value,
    pub profile: Option<DocumentProfile>,
    pub user_directive: Option<String>,
    pub model_id: Option<String>,
}

pub fn proposal_system_prompt() -> &'static str {
    "You are Sparo Markdown Co-author.\n\
You never edit the document directly. Return exactly one JSON object that matches DocumentEditProposal.\n\
For action_id rewrite_selection, return only the rewritten Markdown text for the selected range; the app will wrap it into a proposal.\n\
No Markdown fences, no commentary, no tool calls.\n\
Prefer blockId positions when a target contains block ids. Use replaceDocument only when structured operations are impossible.\n\
For review intent, return comment operations unless the user explicitly asks to change mode.\n\
Reasons and comments should use the profile language when it is provided.\n"
}

pub fn build_proposal_prompt(request: &EditorCoauthorPromptRequest) -> Result<String, String> {
    let target = serde_json::to_string(&request.target)
        .map_err(|error| format!("Failed to serialize target: {}", error))?;

    if request.action_id == "rewrite_selection" {
        return Ok(format!(
            "Rewrite only the selected Markdown range according to the user's directive.\n\
Return the rewritten Markdown text only. Do not return JSON. Do not explain.\n\n\
Metadata:\n\
requestId: {request_id}\n\
actionId: {action_id}\n\
scope: {scope}\n\
intent: {intent}\n\
sourceHash: {source_hash}\n\
target: {target}\n\
userDirective: {user_directive}\n\n\
Document Markdown:\n{document_markdown}",
            request_id = request.request_id,
            action_id = request.action_id,
            scope = request.scope,
            intent = request.intent,
            source_hash = request.source_hash,
            target = target,
            user_directive = request.user_directive.as_deref().unwrap_or("Rewrite this selection clearly."),
            document_markdown = request.document_markdown,
        ));
    }

    let profile_summary = match &request.profile {
        Some(profile) => serde_json::to_string(&serde_json::json!({
            "purpose": profile.purpose,
            "audience": profile.audience,
            "tone": profile.tone,
            "length": profile.length,
            "forbiddenWords": profile.forbidden_words,
            "language": profile.language,
        }))
        .map_err(|error| format!("Failed to serialize profile metadata: {}", error))?,
        None => "null".to_string(),
    };

    Ok(format!(
        "Return a DocumentEditProposal JSON object.\n\
Schema summary:\n\
{{\"proposalId\":\"string\",\"filePath\":\"string?\",\"sourceHash\":\"string\",\"scope\":\"selection|block|document\",\"intent\":\"apply|review\",\"ops\":[...],\"summary\":\"string?\",\"modelId\":\"string?\",\"finishReason\":\"string?\"}}\n\
Operation types:\n\
- replaceRange: {{\"id\":\"string\",\"type\":\"replaceRange\",\"from\":DocPosition,\"to\":DocPosition,\"markdown\":\"string\",\"reason\":\"string?\"}}\n\
- insertAt: {{\"id\":\"string\",\"type\":\"insertAt\",\"position\":DocPosition,\"markdown\":\"string\",\"reason\":\"string?\"}}\n\
- deleteRange: {{\"id\":\"string\",\"type\":\"deleteRange\",\"from\":DocPosition,\"to\":DocPosition,\"reason\":\"string?\"}}\n\
- comment: {{\"id\":\"string\",\"type\":\"comment\",\"from\":DocPosition,\"to\":DocPosition,\"message\":\"string\",\"severity\":\"info|warning|error\"}}\n\
- replaceDocument: {{\"id\":\"string\",\"type\":\"replaceDocument\",\"markdown\":\"string\",\"summary\":\"string?\"}}\n\
DocPosition is blockId, markdownOffset, or lineCol.\n\n\
Metadata:\n\
requestId: {request_id}\n\
actionId: {action_id}\n\
scope: {scope}\n\
intent: {intent}\n\
filePath: {file_path}\n\
sourceHash: {source_hash}\n\
modelId: {model_id}\n\
profile: {profile_summary}\n\
target: {target}\n\
userDirective: {user_directive}\n\n\
Document Markdown:\n{document_markdown}",
        request_id = request.request_id,
        action_id = request.action_id,
        scope = request.scope,
        intent = request.intent,
        file_path = request.file_path.as_deref().unwrap_or(""),
        source_hash = request.source_hash,
        model_id = request.model_id.as_deref().unwrap_or("primary"),
        profile_summary = profile_summary,
        target = target,
        user_directive = request.user_directive.as_deref().unwrap_or(""),
        document_markdown = request.document_markdown,
    ))
}

pub fn normalize_proposal(
    request: &EditorCoauthorPromptRequest,
    full_text: &str,
    finish_reason: Option<String>,
) -> Value {
    let candidate = extract_json_candidate(full_text);
    let parsed = serde_json::from_str::<Value>(&candidate).ok();
    let mut proposal = parsed.unwrap_or_else(|| {
        fallback_proposal(request, full_text.trim(), finish_reason.clone())
    });

    if let Some(object) = proposal.as_object_mut() {
        object
            .entry("proposalId".to_string())
            .or_insert_with(|| Value::String(format!("proposal-{}", request.request_id)));
        object
            .entry("sourceHash".to_string())
            .or_insert_with(|| Value::String(request.source_hash.clone()));
        object
            .entry("scope".to_string())
            .or_insert_with(|| Value::String(request.scope.clone()));
        object
            .entry("intent".to_string())
            .or_insert_with(|| Value::String(request.intent.clone()));
        if let Some(file_path) = &request.file_path {
            object
                .entry("filePath".to_string())
                .or_insert_with(|| Value::String(file_path.clone()));
        }
        object.entry("modelId".to_string()).or_insert_with(|| {
            Value::String(
                request
                    .model_id
                    .clone()
                    .unwrap_or_else(|| "primary".to_string()),
            )
        });
        if let Some(reason) = finish_reason {
            object
                .entry("finishReason".to_string())
                .or_insert_with(|| Value::String(reason));
        }
    }

    proposal
}

fn fallback_proposal(
    request: &EditorCoauthorPromptRequest,
    full_text: &str,
    finish_reason: Option<String>,
) -> Value {
    if request.scope == "selection" {
        if let Some(proposal) = fallback_replace_selection_proposal(request, full_text, finish_reason.clone()) {
            return proposal;
        }
    }

    fallback_replace_document_proposal(request, full_text, finish_reason)
}

fn fallback_replace_selection_proposal(
    request: &EditorCoauthorPromptRequest,
    full_text: &str,
    finish_reason: Option<String>,
) -> Option<Value> {
    if request.target.get("kind").and_then(Value::as_str) != Some("selection") {
        return None;
    }

    let from = request.target.get("from")?.clone();
    let to = request.target.get("to")?.clone();

    Some(serde_json::json!({
        "proposalId": format!("proposal-{}", request.request_id),
        "filePath": request.file_path,
        "sourceHash": request.source_hash,
        "scope": request.scope,
        "intent": request.intent,
        "ops": [{
            "id": "op-rewrite-selection",
            "type": "replaceRange",
            "from": from,
            "to": to,
            "markdown": full_text,
            "reason": "Selection rewrite generated from user intent."
        }],
        "summary": "Selection rewrite proposal",
        "modelId": request.model_id.as_deref().unwrap_or("primary"),
        "finishReason": finish_reason,
    }))
}

fn fallback_replace_document_proposal(
    request: &EditorCoauthorPromptRequest,
    full_text: &str,
    finish_reason: Option<String>,
) -> Value {
    serde_json::json!({
        "proposalId": format!("proposal-{}", request.request_id),
        "filePath": request.file_path,
        "sourceHash": request.source_hash,
        "scope": request.scope,
        "intent": request.intent,
        "ops": [{
            "id": "op-replace-document",
            "type": "replaceDocument",
            "markdown": full_text.trim(),
            "summary": "Model returned free-form text, converted to document diff review."
        }],
        "summary": "Document replacement proposal",
        "modelId": request.model_id.as_deref().unwrap_or("primary"),
        "finishReason": finish_reason,
    })
}

fn extract_json_candidate(text: &str) -> String {
    let trimmed = text.trim();
    if !trimmed.starts_with("```") {
        return trimmed.to_string();
    }

    let mut lines = trimmed.lines();
    let first = lines.next().unwrap_or_default().trim();
    if !first.starts_with("```") {
        return trimmed.to_string();
    }

    let mut body = Vec::new();
    for line in lines {
        if line.trim() == "```" {
            break;
        }
        body.push(line);
    }

    body.join("\n").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> EditorCoauthorPromptRequest {
        EditorCoauthorPromptRequest {
            request_id: "r1".to_string(),
            action_id: "polish".to_string(),
            scope: "block".to_string(),
            intent: "apply".to_string(),
            file_path: None,
            source_hash: "hash".to_string(),
            document_markdown: "Body".to_string(),
            target: serde_json::json!({"kind":"document"}),
            profile: None,
            user_directive: None,
            model_id: Some("primary".to_string()),
        }
    }

    #[test]
    fn parses_fenced_json_proposals() {
        let proposal = normalize_proposal(
            &request(),
            "```json\n{\"proposalId\":\"p1\",\"sourceHash\":\"hash\",\"scope\":\"block\",\"intent\":\"apply\",\"ops\":[{\"id\":\"op1\",\"type\":\"replaceDocument\",\"markdown\":\"Next\"}]}\n```",
            None,
        );

        assert_eq!(proposal["proposalId"], "p1");
        assert_eq!(proposal["ops"][0]["markdown"], "Next");
    }

    #[test]
    fn wraps_freeform_selection_rewrite_as_replace_range() {
        let mut request = request();
        request.action_id = "rewrite_selection".to_string();
        request.scope = "selection".to_string();
        request.target = serde_json::json!({
            "kind": "selection",
            "from": { "kind": "blockId", "blockId": "b1", "offset": 0 },
            "to": { "kind": "blockId", "blockId": "b1", "offset": 4 },
            "markdown": "Body"
        });

        let proposal = normalize_proposal(&request, "Sharper body", Some("stop".to_string()));

        assert_eq!(proposal["ops"][0]["type"], "replaceRange");
        assert_eq!(proposal["ops"][0]["markdown"], "Sharper body");
        assert_eq!(proposal["ops"][0]["from"]["blockId"], "b1");
    }
}
