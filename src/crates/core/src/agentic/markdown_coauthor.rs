//! Platform-agnostic Markdown co-author prompt and proposal normalization.
//!
//! Desktop commands own transport and event emission; this module owns the
//! ephemeral co-author business contract that is shared by app surfaces.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownDocumentProfile {
    pub purpose: Option<String>,
    pub audience: Option<String>,
    pub tone: Option<String>,
    pub length: Option<String>,
    pub forbidden_words: Option<Vec<String>>,
    pub language: Option<String>,
}

#[derive(Debug, Clone)]
pub struct MarkdownCoauthorPromptRequest {
    pub request_id: String,
    pub action_id: String,
    pub scope: String,
    pub intent: String,
    pub file_path: Option<String>,
    pub source_hash: String,
    pub document_markdown: String,
    pub target: Value,
    pub profile: Option<MarkdownDocumentProfile>,
    pub user_directive: Option<String>,
    pub model_id: Option<String>,
}

fn action_contract_prompt(request: &MarkdownCoauthorPromptRequest) -> &'static str {
    match request.action_id.as_str() {
        "continuation" => {
            "Action contract:\n\
- Task: Continue the Markdown document at the current insertion point.\n\
- Allowed operations: insertAt or replaceRange for the current empty insertion block only.\n\
- Do not rewrite, summarize, paraphrase, or restate surrounding blocks.\n\
- Generate new Markdown content that fits the current language, tone, and structure.\n"
        }
        "summary" => {
            "Action contract:\n\
- Task: Summarize the target Markdown clearly for the active audience.\n\
- Allowed operations: replaceRange, insertAt, or replaceDocument only when the scope is document.\n\
- Preserve Markdown validity and do not invent facts beyond the supplied context.\n"
        }
        "todo_extraction" => {
            "Action contract:\n\
- Task: Extract concrete next actions from the target Markdown.\n\
- Allowed operations: replaceRange or insertAt.\n\
- Prefer Markdown task list items and keep each item actionable.\n"
        }
        "polish" => {
            "Action contract:\n\
- Task: Improve clarity, flow, and wording while preserving meaning.\n\
- Allowed operations: replaceRange for selection/block scope, replaceDocument only for document scope.\n\
- Preserve Markdown structure where practical and do not add new claims.\n"
        }
        "shorten" => {
            "Action contract:\n\
- Task: Make the target Markdown more concise.\n\
- Allowed operations: replaceRange only.\n\
- Preserve key meaning and remove redundancy.\n"
        }
        "expand" => {
            "Action contract:\n\
- Task: Expand the target Markdown with useful detail.\n\
- Allowed operations: replaceRange only.\n\
- Stay consistent with nearby context and avoid over-explaining.\n"
        }
        "rephrase" => {
            "Action contract:\n\
- Task: Rephrase the target Markdown without changing meaning.\n\
- Allowed operations: replaceRange only.\n\
- Preserve Markdown syntax and avoid equivalent no-op output.\n"
        }
        "translate" => {
            "Action contract:\n\
- Task: Translate the target Markdown according to the user directive or profile language.\n\
- Allowed operations: replaceRange for selection/block scope, replaceDocument only for document scope.\n\
- Preserve Markdown structure and do not translate code identifiers unless asked.\n"
        }
        "convert_to_list" => {
            "Action contract:\n\
- Task: Convert the target Markdown into a clear list.\n\
- Allowed operations: replaceRange only.\n\
- Use Markdown list syntax and keep all important points.\n"
        }
        "extract_headings" => {
            "Action contract:\n\
- Task: Create or refine a useful Markdown heading outline from the document.\n\
- Allowed operations: insertAt or replaceDocument.\n\
- Use a valid heading hierarchy and avoid duplicate headings.\n"
        }
        "outline_check" => {
            "Action contract:\n\
- Task: Review the Markdown outline for structure, hierarchy, and missing sections.\n\
- Allowed operations: comment only.\n\
- Do not modify the document.\n"
        }
        "consistency_check" => {
            "Action contract:\n\
- Task: Review the Markdown document for inconsistent terminology, tone, and claims.\n\
- Allowed operations: comment only.\n\
- Cite affected ranges precisely and make comments actionable.\n"
        }
        "glossary_check" => {
            "Action contract:\n\
- Task: Review glossary and terminology consistency in the Markdown document.\n\
- Allowed operations: comment only.\n\
- Prefer actionable terminology notes.\n"
        }
        _ => {
            "Action contract:\n\
- Task: Follow the actionId and user directive for the target Markdown.\n\
- Prefer scoped operations over replaceDocument.\n\
- Preserve Markdown validity and avoid unrelated edits.\n"
        }
    }
}

pub fn proposal_system_prompt() -> &'static str {
    "You are Sparo Markdown Co-author.\n\
You never edit the document directly. Return exactly one JSON object that matches MarkdownEditProposal.\n\
For action_id rewrite_selection, return only the rewritten Markdown text for the selected range; the app will wrap it into a proposal.\n\
For selected Markdown rewrites, preserve the original Markdown block structure and inline syntax unless the user explicitly asks to change it.\n\
Do not add wrapper Markdown fences around your whole answer. If the selected range is itself a fenced code block, keep or change that fence only as part of the replacement.\n\
No commentary, no tool calls.\n\
Prefer blockId positions when a target contains block ids. Use replaceDocument only when structured operations are impossible.\n\
For review intent, return comment operations unless the user explicitly asks to change mode.\n\
Reasons and comments should use the profile language when it is provided.\n"
}

pub fn build_proposal_prompt(request: &MarkdownCoauthorPromptRequest) -> Result<String, String> {
    let target = serde_json::to_string(&request.target)
        .map_err(|error| format!("Failed to serialize target: {}", error))?;
    let action_contract = action_contract_prompt(request);

    if request.action_id == "rewrite_selection" {
        let selected_markdown = request
            .target
            .get("markdown")
            .and_then(Value::as_str)
            .unwrap_or("");
        return Ok(format!(
            "Rewrite only the selected Markdown range according to the user's directive.\n\
Return the rewritten Markdown text only. Do not return JSON. Do not explain.\n\n\
{action_contract}\n\
Rules:\n\
- Treat Selected Markdown as the exact editable source of truth.\n\
- Preserve Markdown structure by default: lists remain lists, headings remain headings, bold/emphasis/code/link syntax remains when still applicable.\n\
- If the directive asks to optimize, polish, or rewrite, do not return text that is equivalent to Selected Markdown. Make a real improvement.\n\
- Return only replacement Markdown for the selected range, with no surrounding document content.\n\n\
Metadata:\n\
requestId: {request_id}\n\
actionId: {action_id}\n\
scope: {scope}\n\
intent: {intent}\n\
sourceHash: {source_hash}\n\
target: {target}\n\
userDirective: {user_directive}\n\n\
Selected Markdown:\n{selected_markdown}\n\n\
Nearby Document Context:\n{document_markdown}",
            request_id = request.request_id,
            action_id = request.action_id,
            scope = request.scope,
            intent = request.intent,
            source_hash = request.source_hash,
            target = target,
            user_directive = request.user_directive.as_deref().unwrap_or("Rewrite this selection clearly."),
            selected_markdown = selected_markdown,
            document_markdown = request.document_markdown,
            action_contract = action_contract,
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
        "Return a MarkdownEditProposal JSON object.\n\
Schema summary:\n\
{{\"proposalId\":\"string\",\"filePath\":\"string?\",\"sourceHash\":\"string\",\"scope\":\"selection|block|document\",\"intent\":\"apply|review\",\"ops\":[...],\"summary\":\"string?\",\"modelId\":\"string?\",\"finishReason\":\"string?\"}}\n\
Operation types:\n\
- replaceRange: {{\"id\":\"string\",\"type\":\"replaceRange\",\"from\":DocPosition,\"to\":DocPosition,\"markdown\":\"string\",\"reason\":\"string?\"}}\n\
- insertAt: {{\"id\":\"string\",\"type\":\"insertAt\",\"position\":DocPosition,\"markdown\":\"string\",\"reason\":\"string?\"}}\n\
- deleteRange: {{\"id\":\"string\",\"type\":\"deleteRange\",\"from\":DocPosition,\"to\":DocPosition,\"reason\":\"string?\"}}\n\
- comment: {{\"id\":\"string\",\"type\":\"comment\",\"from\":DocPosition,\"to\":DocPosition,\"message\":\"string\",\"severity\":\"info|warning|error\"}}\n\
- replaceDocument: {{\"id\":\"string\",\"type\":\"replaceDocument\",\"markdown\":\"string\",\"summary\":\"string?\"}}\n\
DocPosition is blockId, markdownOffset, or lineCol.\n\n\
{action_contract}\n\
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
        action_contract = action_contract,
    ))
}

pub fn normalize_proposal(
    request: &MarkdownCoauthorPromptRequest,
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
    request: &MarkdownCoauthorPromptRequest,
    full_text: &str,
    finish_reason: Option<String>,
) -> Value {
    if request.scope == "selection" || request.scope == "block" {
        if let Some(proposal) = fallback_replace_scoped_proposal(request, full_text, finish_reason.clone()) {
            return proposal;
        }
    }

    fallback_replace_document_proposal(request, full_text, finish_reason)
}

fn fallback_replace_scoped_proposal(
    request: &MarkdownCoauthorPromptRequest,
    full_text: &str,
    finish_reason: Option<String>,
) -> Option<Value> {
    let target_kind = request.target.get("kind").and_then(Value::as_str);
    if target_kind != Some("selection") && target_kind != Some("block") {
        return None;
    }

    let from = request.target.get("from")?.clone();
    let to = request.target.get("to")?.clone();
    let op_id = if target_kind == Some("selection") {
        "op-rewrite-selection"
    } else {
        "op-rewrite-block"
    };
    let summary = if target_kind == Some("selection") {
        "Selection rewrite proposal"
    } else {
        "Block edit proposal"
    };

    Some(serde_json::json!({
        "proposalId": format!("proposal-{}", request.request_id),
        "filePath": request.file_path,
        "sourceHash": request.source_hash,
        "scope": request.scope,
        "intent": request.intent,
        "ops": [{
            "id": op_id,
            "type": "replaceRange",
            "from": from,
            "to": to,
            "markdown": full_text,
            "reason": "Markdown edit generated from user intent."
        }],
        "summary": summary,
        "modelId": request.model_id.as_deref().unwrap_or("primary"),
        "finishReason": finish_reason,
    }))
}

fn fallback_replace_document_proposal(
    request: &MarkdownCoauthorPromptRequest,
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

    fn request() -> MarkdownCoauthorPromptRequest {
        MarkdownCoauthorPromptRequest {
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
