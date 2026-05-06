use super::types::{
    PromptAsset, PromptAssetMetadata, PromptValidationIssue, PromptValidationReport,
    PromptValidationSeverity,
};
use crate::util::errors::{BitFunError, BitFunResult};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

const PROMPT_EXTENSION: &str = ".prompt.md";

pub fn parse_prompt_asset(
    path: &Path,
    prompt_root: &Path,
    content: &str,
) -> BitFunResult<PromptAsset> {
    let (metadata_text, body) = split_front_matter(content)?;
    let metadata: PromptAssetMetadata = serde_yaml::from_str(metadata_text)
        .map_err(|e| BitFunError::parse(format!("Failed to parse prompt metadata: {e}")))?;
    let relative_path = path
        .strip_prefix(prompt_root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    Ok(PromptAsset {
        metadata,
        body: body.trim_start().to_string(),
        relative_path,
        absolute_path: path.to_string_lossy().to_string(),
        content_hash: content_hash(content),
    })
}

pub fn serialize_prompt_asset(metadata: &PromptAssetMetadata, body: &str) -> BitFunResult<String> {
    let metadata_text = serde_yaml::to_string(metadata).map_err(|e| {
        BitFunError::serialization(format!("Failed to serialize prompt metadata: {e}"))
    })?;
    Ok(format!(
        "---\n{}---\n\n{}\n",
        metadata_text,
        body.trim_start().trim_end()
    ))
}

pub fn validate_prompt_content(content: &str) -> PromptValidationReport {
    let mut issues = Vec::new();
    let Ok((metadata_text, body)) = split_front_matter(content) else {
        return PromptValidationReport::new(vec![PromptValidationIssue {
            severity: PromptValidationSeverity::Error,
            code: "missingFrontMatter".to_string(),
            message: "Prompt file must start with YAML front matter".to_string(),
        }]);
    };

    match serde_yaml::from_str::<PromptAssetMetadata>(metadata_text) {
        Ok(metadata) => validate_metadata(&metadata, &mut issues),
        Err(error) => issues.push(PromptValidationIssue {
            severity: PromptValidationSeverity::Error,
            code: "invalidMetadata".to_string(),
            message: format!("Prompt metadata is invalid: {error}"),
        }),
    }

    if body.trim().is_empty() {
        issues.push(PromptValidationIssue {
            severity: PromptValidationSeverity::Error,
            code: "emptyBody".to_string(),
            message: "Prompt body is required".to_string(),
        });
    }

    PromptValidationReport::new(issues)
}

pub fn validate_asset(asset: &PromptAsset) -> PromptValidationReport {
    let mut issues = Vec::new();
    validate_metadata(&asset.metadata, &mut issues);
    if asset.body.trim().is_empty() {
        issues.push(PromptValidationIssue {
            severity: PromptValidationSeverity::Error,
            code: "emptyBody".to_string(),
            message: "Prompt body is required".to_string(),
        });
    }
    PromptValidationReport::new(issues)
}

pub fn prompt_file_name(id: &str) -> String {
    format!("{}{PROMPT_EXTENSION}", slugify_id(id))
}

pub fn is_prompt_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.ends_with(PROMPT_EXTENSION))
}

pub fn ensure_safe_relative_path(relative_path: &str) -> BitFunResult<PathBuf> {
    let path = PathBuf::from(relative_path.replace('\\', "/"));
    if path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(BitFunError::validation(
            "Prompt path must stay inside the prompt store",
        ));
    }
    if !is_prompt_file(&path) {
        return Err(BitFunError::validation(
            "Prompt path must end with .prompt.md",
        ));
    }
    Ok(path)
}

fn split_front_matter(content: &str) -> BitFunResult<(&str, &str)> {
    let normalized = content
        .strip_prefix("---\r\n")
        .or_else(|| content.strip_prefix("---\n"));
    let Some(after_start) = normalized else {
        return Err(BitFunError::parse("Missing prompt front matter"));
    };

    if let Some(index) = after_start.find("\r\n---\r\n") {
        let metadata = &after_start[..index];
        let body = &after_start[index + "\r\n---\r\n".len()..];
        return Ok((metadata, body));
    }
    if let Some(index) = after_start.find("\n---\n") {
        let metadata = &after_start[..index];
        let body = &after_start[index + "\n---\n".len()..];
        return Ok((metadata, body));
    }
    Err(BitFunError::parse(
        "Missing closing prompt front matter marker",
    ))
}

fn validate_metadata(metadata: &PromptAssetMetadata, issues: &mut Vec<PromptValidationIssue>) {
    if metadata.schema_version != 1 {
        issues.push(PromptValidationIssue {
            severity: PromptValidationSeverity::Error,
            code: "unsupportedSchemaVersion".to_string(),
            message: "Only prompt schema version 1 is supported".to_string(),
        });
    }
    if metadata.id.trim().is_empty() {
        issues.push(PromptValidationIssue {
            severity: PromptValidationSeverity::Error,
            code: "missingId".to_string(),
            message: "Prompt id is required".to_string(),
        });
    }
    if metadata.name.trim().is_empty() {
        issues.push(PromptValidationIssue {
            severity: PromptValidationSeverity::Error,
            code: "missingName".to_string(),
            message: "Prompt name is required".to_string(),
        });
    }
}

fn slugify_id(id: &str) -> String {
    let mut out = String::new();
    for ch in id.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if matches!(ch, '-' | '_' | '.') {
            out.push(ch);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let trimmed = out.trim_matches('-');
    if trimmed.is_empty() {
        "prompt".to_string()
    } else {
        trimmed.to_string()
    }
}

fn content_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    hex::encode(hasher.finalize())
}
