//! Canonical Composer submission contract and model-input compiler.
//!
//! Product surfaces send document structure and attachment resources. The
//! Runtime decides how to compile them, so attachment position, identity, and
//! provider payloads cannot drift between send entry points.

use crate::error::{CoreError, CoreResult};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

const INLINE_TEXT_CHARACTER_LIMIT: usize = 800;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ComposerSubmissionIntent {
    Normal,
    Goal,
    Btw,
    McpPrompt,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ComposerSubmissionNode {
    Text { text: String },
    AttachmentRef { attachment_id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ComposerSubmissionAttachment {
    pub id: String,
    pub ordinal: usize,
    #[serde(rename = "type")]
    pub attachment_type: String,
    pub title: String,
    #[serde(default)]
    pub model_content: Option<String>,
    #[serde(default)]
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ComposerSubmissionDocument {
    pub nodes: Vec<ComposerSubmissionNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ComposerSubmissionEnvelope {
    pub schema_version: u32,
    pub intent: ComposerSubmissionIntent,
    pub document: ComposerSubmissionDocument,
    pub attachments: Vec<ComposerSubmissionAttachment>,
    pub created_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompiledComposerSubmission {
    pub user_input: String,
    pub image_attachment_ids: Vec<String>,
}

fn escape_attribute(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn fallback_request(attachment_count: usize) -> &'static str {
    match attachment_count {
        0 => "",
        1 => "Please review the attached content.",
        _ => "Please review the attached materials together.",
    }
}

fn render_reference(attachment: &ComposerSubmissionAttachment) -> String {
    format!(
        "<attachment_ref id=\"{}\" number=\"{}\" title=\"{}\" />",
        escape_attribute(&attachment.id),
        attachment.ordinal,
        escape_attribute(&attachment.title),
    )
}

fn render_attachment(attachment: &ComposerSubmissionAttachment) -> String {
    let content = attachment
        .model_content
        .as_deref()
        .filter(|content| !content.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            if attachment.attachment_type == "image" {
                format!(
                    "[Image supplied in the multimodal block labelled Attachment {}]",
                    attachment.ordinal
                )
            } else {
                "[Attachment has no textual body]".to_string()
            }
        });
    format!(
        "<attachment id=\"{}\" number=\"{}\" type=\"{}\" title=\"{}\">\n{}\n</attachment>",
        escape_attribute(&attachment.id),
        attachment.ordinal,
        escape_attribute(&attachment.attachment_type),
        escape_attribute(&attachment.title),
        content,
    )
}

pub fn compile_composer_submission(
    submission: &ComposerSubmissionEnvelope,
) -> CoreResult<CompiledComposerSubmission> {
    if submission.schema_version != 1 {
        return Err(CoreError::validation(format!(
            "Unsupported Composer submission schema version: {}",
            submission.schema_version
        )));
    }

    let mut attachment_by_id = HashMap::with_capacity(submission.attachments.len());
    let mut ordinals = HashSet::with_capacity(submission.attachments.len());
    for attachment in &submission.attachments {
        if attachment.id.trim().is_empty() {
            return Err(CoreError::validation("Composer attachment id is required"));
        }
        if attachment.ordinal == 0 || !ordinals.insert(attachment.ordinal) {
            return Err(CoreError::validation(format!(
                "Composer attachment ordinal must be unique and positive: {}",
                attachment.ordinal
            )));
        }
        if attachment_by_id
            .insert(attachment.id.as_str(), attachment)
            .is_some()
        {
            return Err(CoreError::validation(format!(
                "Duplicate Composer attachment id: {}",
                attachment.id
            )));
        }
    }

    let mut reference_counts: HashMap<&str, usize> = HashMap::new();
    for node in &submission.document.nodes {
        let ComposerSubmissionNode::AttachmentRef { attachment_id } = node else {
            continue;
        };
        if !attachment_by_id.contains_key(attachment_id.as_str()) {
            return Err(CoreError::validation(format!(
                "Composer document references a missing attachment: {}",
                attachment_id
            )));
        }
        *reference_counts.entry(attachment_id).or_default() += 1;
    }

    let inline_attachment_id = submission.attachments.first().and_then(|attachment| {
        let content = attachment.model_content.as_deref()?.trim();
        let is_single_short_text = submission.attachments.len() == 1
            && attachment.attachment_type == "text-fragment"
            && reference_counts.get(attachment.id.as_str()) == Some(&1)
            && !content.is_empty()
            && content.chars().count() <= INLINE_TEXT_CHARACTER_LIMIT;
        is_single_short_text.then_some(attachment.id.as_str())
    });

    let mut request = String::new();
    for node in &submission.document.nodes {
        match node {
            ComposerSubmissionNode::Text { text } => request.push_str(text),
            ComposerSubmissionNode::AttachmentRef { attachment_id } => {
                let attachment = attachment_by_id[attachment_id.as_str()];
                if inline_attachment_id == Some(attachment_id.as_str()) {
                    request.push_str(&render_attachment(attachment));
                } else {
                    request.push_str(&render_reference(attachment));
                }
            }
        }
    }
    if request.trim().is_empty() {
        request.push_str(fallback_request(submission.attachments.len()));
    }

    let attachment_blocks = submission
        .attachments
        .iter()
        .filter(|attachment| inline_attachment_id != Some(attachment.id.as_str()))
        .map(render_attachment)
        .collect::<Vec<_>>();

    let mut user_input = format!("<user_request>\n{}\n</user_request>", request.trim());
    if !attachment_blocks.is_empty() {
        user_input.push_str(&format!(
            "\n\n<attachments count=\"{}\">\n{}\n</attachments>",
            attachment_blocks.len(),
            attachment_blocks.join("\n\n"),
        ));
    }

    let image_attachment_ids = submission
        .attachments
        .iter()
        .filter(|attachment| attachment.attachment_type == "image")
        .map(|attachment| attachment.id.clone())
        .collect();

    Ok(CompiledComposerSubmission {
        user_input,
        image_attachment_ids,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attachment(id: &str, ordinal: usize, content: &str) -> ComposerSubmissionAttachment {
        ComposerSubmissionAttachment {
            id: id.to_string(),
            ordinal,
            attachment_type: "text-fragment".to_string(),
            title: format!("Attachment {ordinal}"),
            model_content: Some(content.to_string()),
            mime_type: None,
        }
    }

    fn submission(
        nodes: Vec<ComposerSubmissionNode>,
        attachments: Vec<ComposerSubmissionAttachment>,
    ) -> ComposerSubmissionEnvelope {
        ComposerSubmissionEnvelope {
            schema_version: 1,
            intent: ComposerSubmissionIntent::Normal,
            document: ComposerSubmissionDocument { nodes },
            attachments,
            created_at: 1,
        }
    }

    #[test]
    fn frontend_camel_case_envelope_deserializes_at_the_runtime_boundary() {
        let value = serde_json::json!({
            "schemaVersion": 1,
            "intent": "mcp_prompt",
            "document": {
                "nodes": [
                    { "type": "text", "text": "Review " },
                    { "type": "attachment_ref", "attachmentId": "source-1" }
                ]
            },
            "attachments": [{
                "id": "source-1",
                "ordinal": 1,
                "type": "text-fragment",
                "title": "Source",
                "modelContent": "Canonical body",
                "mimeType": null
            }],
            "createdAt": 123
        });

        let envelope: ComposerSubmissionEnvelope = serde_json::from_value(value).unwrap();

        assert_eq!(envelope.intent, ComposerSubmissionIntent::McpPrompt);
        assert_eq!(
            envelope.document.nodes[1],
            ComposerSubmissionNode::AttachmentRef {
                attachment_id: "source-1".to_string(),
            }
        );
        assert_eq!(envelope.attachments[0].attachment_type, "text-fragment");
    }

    #[test]
    fn single_short_text_is_inlined_at_its_reference() {
        let compiled = compile_composer_submission(&submission(
            vec![
                ComposerSubmissionNode::Text {
                    text: "Summarize ".to_string(),
                },
                ComposerSubmissionNode::AttachmentRef {
                    attachment_id: "a".to_string(),
                },
                ComposerSubmissionNode::Text {
                    text: " briefly.".to_string(),
                },
            ],
            vec![attachment("a", 1, "Short source")],
        ))
        .unwrap();

        assert!(compiled
            .user_input
            .contains("Summarize <attachment id=\"a\""));
        assert!(!compiled.user_input.contains("<attachments count="));
        assert_eq!(compiled.user_input.matches("Short source").count(), 1);
    }

    #[test]
    fn long_text_uses_reference_and_appendix() {
        let long = "x".repeat(INLINE_TEXT_CHARACTER_LIMIT + 1);
        let compiled = compile_composer_submission(&submission(
            vec![ComposerSubmissionNode::AttachmentRef {
                attachment_id: "a".to_string(),
            }],
            vec![attachment("a", 1, &long)],
        ))
        .unwrap();

        assert!(compiled
            .user_input
            .contains("<attachment_ref id=\"a\" number=\"1\""));
        assert!(compiled.user_input.contains("<attachments count=\"1\">"));
        assert_eq!(compiled.user_input.matches(&long).count(), 1);
    }

    #[test]
    fn multiple_references_share_one_attachment_body() {
        let compiled = compile_composer_submission(&submission(
            vec![
                ComposerSubmissionNode::AttachmentRef {
                    attachment_id: "a".to_string(),
                },
                ComposerSubmissionNode::Text {
                    text: " versus ".to_string(),
                },
                ComposerSubmissionNode::AttachmentRef {
                    attachment_id: "a".to_string(),
                },
            ],
            vec![attachment("a", 1, "Shared body")],
        ))
        .unwrap();

        assert_eq!(compiled.user_input.matches("<attachment_ref").count(), 2);
        assert_eq!(compiled.user_input.matches("Shared body").count(), 1);
    }

    #[test]
    fn attachment_only_submission_gets_a_minimal_request() {
        let compiled = compile_composer_submission(&submission(
            Vec::new(),
            vec![attachment("a", 1, "Attached body")],
        ))
        .unwrap();

        assert!(compiled
            .user_input
            .contains("Please review the attached content."));
        assert!(compiled.user_input.contains("Attached body"));
    }
}
