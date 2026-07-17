use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex, OnceLock, Weak};

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::fs::{self, OpenOptions};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

use crate::agentic_os::work::WorkId;
use crate::app_platform::{atomic_write_json, recover_atomic_json, ProductAppRuntimeStorage};
use crate::error::{CoreError, CoreResult};

const DECK_DIR: &str = "ppt-deck";
const MANUSCRIPT_FILE: &str = "manuscript.md";
const DECK_META_FILE: &str = "deck.json";
const HISTORY_DIR: &str = "history";
const LEGACY_STATE_KEY: &str = "pptLiveStudioStateV6";
const MAX_IDEMPOTENCY_RECORDS: usize = 128;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManuscriptDiagnostic {
    pub severity: String,
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManuscriptDocument {
    pub document_id: String,
    pub deck_id: String,
    pub relative_path: String,
    pub content: String,
    pub revision: u64,
    pub content_hash: String,
    pub updated_at_ms: u64,
    #[serde(default)]
    pub diagnostics: Vec<ManuscriptDiagnostic>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManuscriptCommitRequest {
    pub content: String,
    pub expected_revision: u64,
    pub expected_content_hash: String,
    #[serde(default)]
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManuscriptCommitResult {
    pub document: ManuscriptDocument,
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdempotencyRecord {
    revision: u64,
    content_hash: String,
    #[serde(default)]
    updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeckProjectMetadata {
    schema_version: u32,
    deck_id: String,
    manuscript_revision: u64,
    manuscript_content_hash: String,
    updated_at_ms: u64,
    #[serde(default)]
    idempotency: BTreeMap<String, IdempotencyRecord>,
}

#[derive(Debug, Clone)]
pub struct PptDeckService {
    runtime_storage: ProductAppRuntimeStorage,
}

impl PptDeckService {
    pub fn new(runtime_storage: ProductAppRuntimeStorage) -> Self {
        Self { runtime_storage }
    }

    pub async fn read_manuscript(
        &self,
        work_id: &WorkId,
        runtime_instance_id: &str,
    ) -> CoreResult<ManuscriptDocument> {
        let deck_dir = self.deck_dir(work_id, runtime_instance_id)?;
        let document_lock = document_lock(&deck_dir);
        let _guard = document_lock.lock().await;
        self.read_or_initialize_locked(work_id, runtime_instance_id, &deck_dir)
            .await
    }

    pub async fn commit_manuscript(
        &self,
        work_id: &WorkId,
        runtime_instance_id: &str,
        request: ManuscriptCommitRequest,
    ) -> CoreResult<ManuscriptCommitResult> {
        let deck_dir = self.deck_dir(work_id, runtime_instance_id)?;
        let document_lock = document_lock(&deck_dir);
        let _guard = document_lock.lock().await;
        let current = self
            .read_or_initialize_locked(work_id, runtime_instance_id, &deck_dir)
            .await?;

        let normalized_content = normalize_document_content(&request.content);
        let next_hash = content_hash(&normalized_content);
        let idempotency_key = normalize_idempotency_key(request.idempotency_key.as_deref())?;
        let mut metadata = load_metadata(&deck_dir).await?;

        if let Some(key) = idempotency_key.as_deref() {
            if let Some(record) = metadata.idempotency.get(key) {
                if record.content_hash != next_hash {
                    return Err(CoreError::validation(format!(
                        "ppt.manuscript.idempotency_conflict: key '{key}' was already used for a different document"
                    )));
                }
                return Ok(ManuscriptCommitResult {
                    document: document_for_idempotency_record(&deck_dir, &metadata, record).await?,
                    replayed: true,
                });
            }
        }

        if request.expected_revision != current.revision
            || request.expected_content_hash.trim() != current.content_hash
        {
            return Err(CoreError::validation(format!(
                "ppt.manuscript.revision_conflict: expected revision {} and hash {}, current revision {} and hash {}",
                request.expected_revision,
                request.expected_content_hash.trim(),
                current.revision,
                current.content_hash
            )));
        }

        let diagnostics = validate_manuscript(&normalized_content);
        if diagnostics.iter().any(|item| item.severity == "error") {
            return Err(CoreError::validation(format!(
                "ppt.manuscript.invalid: {}",
                serde_json::to_string(&diagnostics).unwrap_or_else(|_| "[]".to_string())
            )));
        }

        if next_hash == current.content_hash {
            if let Some(key) = idempotency_key {
                metadata.idempotency.insert(
                    key,
                    IdempotencyRecord {
                        revision: current.revision,
                        content_hash: current.content_hash.clone(),
                        updated_at_ms: current.updated_at_ms,
                    },
                );
                trim_idempotency_records(&mut metadata.idempotency);
                atomic_write_json(&deck_dir.join(DECK_META_FILE), &metadata).await?;
            }
            return Ok(ManuscriptCommitResult {
                document: current,
                replayed: true,
            });
        }

        let next_revision = current.revision.saturating_add(1);
        let updated_at_ms = now_ms();
        let history_path = history_path(&deck_dir, next_revision, &next_hash);
        write_new_synced_file(&history_path, normalized_content.as_bytes()).await?;

        let manuscript_path = deck_dir.join(MANUSCRIPT_FILE);
        let backup_path = atomic_text_backup_path(&manuscript_path);
        replace_text_with_backup(&manuscript_path, &backup_path, &normalized_content).await?;

        metadata.manuscript_revision = next_revision;
        metadata.manuscript_content_hash = next_hash.clone();
        metadata.updated_at_ms = updated_at_ms;
        if let Some(key) = idempotency_key {
            metadata.idempotency.insert(
                key,
                IdempotencyRecord {
                    revision: next_revision,
                    content_hash: next_hash.clone(),
                    updated_at_ms,
                },
            );
            trim_idempotency_records(&mut metadata.idempotency);
        }

        if let Err(error) = atomic_write_json(&deck_dir.join(DECK_META_FILE), &metadata).await {
            restore_text_backup(&manuscript_path, &backup_path).await;
            return Err(error);
        }
        remove_if_present(&backup_path).await?;

        Ok(ManuscriptCommitResult {
            document: ManuscriptDocument {
                document_id: "manuscript".to_string(),
                deck_id: metadata.deck_id,
                relative_path: MANUSCRIPT_FILE.to_string(),
                content: normalized_content,
                revision: next_revision,
                content_hash: next_hash,
                updated_at_ms,
                diagnostics,
            },
            replayed: false,
        })
    }

    fn deck_dir(&self, work_id: &WorkId, runtime_instance_id: &str) -> CoreResult<PathBuf> {
        Ok(self
            .runtime_storage
            .runtime_dir(work_id, runtime_instance_id)?
            .join(DECK_DIR))
    }

    async fn read_or_initialize_locked(
        &self,
        work_id: &WorkId,
        runtime_instance_id: &str,
        deck_dir: &Path,
    ) -> CoreResult<ManuscriptDocument> {
        fs::create_dir_all(deck_dir.join(HISTORY_DIR)).await?;
        let metadata_path = deck_dir.join(DECK_META_FILE);
        recover_atomic_json(&metadata_path).await?;

        if !fs::try_exists(&metadata_path).await? {
            let legacy_state = self
                .runtime_storage
                .get_storage(work_id, runtime_instance_id, LEGACY_STATE_KEY)
                .await?;
            return initialize_document(deck_dir, work_id, runtime_instance_id, &legacy_state)
                .await;
        }

        let metadata = load_metadata(deck_dir).await?;
        recover_manuscript_for_metadata(deck_dir, &metadata).await?;
        let content = fs::read_to_string(deck_dir.join(MANUSCRIPT_FILE)).await?;
        let actual_hash = content_hash(&content);
        if actual_hash != metadata.manuscript_content_hash {
            return Err(CoreError::validation(format!(
                "ppt.manuscript.hash_mismatch: expected {}, got {}",
                metadata.manuscript_content_hash, actual_hash
            )));
        }

        Ok(ManuscriptDocument {
            document_id: "manuscript".to_string(),
            deck_id: metadata.deck_id,
            relative_path: MANUSCRIPT_FILE.to_string(),
            diagnostics: validate_manuscript(&content),
            content,
            revision: metadata.manuscript_revision,
            content_hash: metadata.manuscript_content_hash,
            updated_at_ms: metadata.updated_at_ms,
        })
    }
}

async fn initialize_document(
    deck_dir: &Path,
    work_id: &WorkId,
    runtime_instance_id: &str,
    legacy_state: &Value,
) -> CoreResult<ManuscriptDocument> {
    let deck_id = legacy_state
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("{}-{}", work_id.as_str(), runtime_instance_id));
    let content = manuscript_from_legacy_state(&deck_id, legacy_state);
    let hash = content_hash(&content);
    let updated_at_ms = now_ms();
    let metadata = DeckProjectMetadata {
        schema_version: 1,
        deck_id: deck_id.clone(),
        manuscript_revision: 1,
        manuscript_content_hash: hash.clone(),
        updated_at_ms,
        idempotency: BTreeMap::new(),
    };

    let history = history_path(deck_dir, 1, &hash);
    write_new_synced_file(&history, content.as_bytes()).await?;
    let manuscript_path = deck_dir.join(MANUSCRIPT_FILE);
    let backup_path = atomic_text_backup_path(&manuscript_path);
    replace_text_with_backup(&manuscript_path, &backup_path, &content).await?;
    if let Err(error) = atomic_write_json(&deck_dir.join(DECK_META_FILE), &metadata).await {
        restore_text_backup(&manuscript_path, &backup_path).await;
        return Err(error);
    }
    remove_if_present(&backup_path).await?;

    Ok(ManuscriptDocument {
        document_id: "manuscript".to_string(),
        deck_id,
        relative_path: MANUSCRIPT_FILE.to_string(),
        diagnostics: validate_manuscript(&content),
        content,
        revision: 1,
        content_hash: hash,
        updated_at_ms,
    })
}

async fn load_metadata(deck_dir: &Path) -> CoreResult<DeckProjectMetadata> {
    let path = deck_dir.join(DECK_META_FILE);
    recover_atomic_json(&path).await?;
    let content = fs::read(&path).await?;
    serde_json::from_slice(&content).map_err(|error| {
        CoreError::parse(format!(
            "Invalid PPT Deck metadata {}: {error}",
            path.display()
        ))
    })
}

async fn document_for_idempotency_record(
    deck_dir: &Path,
    metadata: &DeckProjectMetadata,
    record: &IdempotencyRecord,
) -> CoreResult<ManuscriptDocument> {
    let path = history_path(deck_dir, record.revision, &record.content_hash);
    let content = fs::read_to_string(&path).await.map_err(|error| {
        CoreError::validation(format!(
            "ppt.manuscript.idempotency_history_unavailable: revision {} ({}) at {}: {error}",
            record.revision,
            record.content_hash,
            path.display()
        ))
    })?;
    let actual_hash = content_hash(&content);
    if actual_hash != record.content_hash {
        return Err(CoreError::validation(format!(
            "ppt.manuscript.idempotency_history_mismatch: revision {} expected {}, got {}",
            record.revision, record.content_hash, actual_hash
        )));
    }

    let updated_at_ms = if record.updated_at_ms > 0 {
        record.updated_at_ms
    } else if record.revision == metadata.manuscript_revision
        && record.content_hash == metadata.manuscript_content_hash
    {
        metadata.updated_at_ms
    } else {
        0
    };

    Ok(ManuscriptDocument {
        document_id: "manuscript".to_string(),
        deck_id: metadata.deck_id.clone(),
        relative_path: MANUSCRIPT_FILE.to_string(),
        diagnostics: validate_manuscript(&content),
        content,
        revision: record.revision,
        content_hash: record.content_hash.clone(),
        updated_at_ms,
    })
}

fn trim_idempotency_records(records: &mut BTreeMap<String, IdempotencyRecord>) {
    while records.len() > MAX_IDEMPOTENCY_RECORDS {
        let Some(oldest) = records.keys().next().cloned() else {
            break;
        };
        records.remove(&oldest);
    }
}

async fn recover_manuscript_for_metadata(
    deck_dir: &Path,
    metadata: &DeckProjectMetadata,
) -> CoreResult<()> {
    let path = deck_dir.join(MANUSCRIPT_FILE);
    let backup = atomic_text_backup_path(&path);
    if file_matches_hash(&path, &metadata.manuscript_content_hash).await? {
        remove_if_present(&backup).await?;
        return Ok(());
    }
    if file_matches_hash(&backup, &metadata.manuscript_content_hash).await? {
        remove_if_present(&path).await?;
        fs::rename(&backup, &path).await?;
        return Ok(());
    }

    let history = history_path(
        deck_dir,
        metadata.manuscript_revision,
        &metadata.manuscript_content_hash,
    );
    if !file_matches_hash(&history, &metadata.manuscript_content_hash).await? {
        return Err(CoreError::validation(format!(
            "PPT manuscript cannot be recovered for revision {} ({})",
            metadata.manuscript_revision, metadata.manuscript_content_hash
        )));
    }
    let content = fs::read_to_string(history).await?;
    replace_text_with_backup(&path, &backup, &content).await?;
    remove_if_present(&backup).await
}

fn manuscript_from_legacy_state(deck_id: &str, state: &Value) -> String {
    let title = state
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Untitled deck");
    let topic = state
        .pointer("/brief/topic")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(title);
    let style_preset = state
        .pointer("/style/stylePreset")
        .and_then(Value::as_str)
        .unwrap_or("clean-business");
    let font_family = state
        .pointer("/style/fontFamily")
        .and_then(Value::as_str)
        .unwrap_or("sans");
    let density = state
        .pointer("/style/density")
        .and_then(Value::as_str)
        .unwrap_or("standard");
    let color_mode = state
        .pointer("/style/colorMode")
        .and_then(Value::as_str)
        .unwrap_or("light");

    let mut out = format!(
        "---\npptSchema: 1\ndeckId: {}\nlanguage: zh-CN\nstylePreset: {}\n---\n\n# {}\n\n## 创作简报\n\n{}\n\n## 叙事主线\n\n围绕主题形成从问题、判断、证据到行动的完整讲述。\n\n## 视觉总则\n\n- 风格模式：{}\n- 字体：{}\n- 信息密度：{}\n- 色彩模式：{}\n\n## 来源\n\n- 当前文稿由已有 PPT Live Deck 状态迁移生成；未经核验的内容应视为待确认。\n\n<!-- ppt:chapter id=\"chapter-main\" revision=\"1\" -->\n## 未分组\n\n",
        markdown_scalar(deck_id),
        markdown_scalar(style_preset),
        markdown_text(title),
        markdown_text(topic),
        markdown_text(style_preset),
        markdown_text(font_family),
        markdown_text(density),
        markdown_text(color_mode),
    );

    if let Some(slides) = state.get("slides").and_then(Value::as_array) {
        for (index, slide) in slides.iter().enumerate() {
            let slide_id = slide
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| format!("slide-spec-{}", index + 1));
            let slide_title = text_field(slide, "title", "Untitled slide");
            let claim = text_field(slide, "claim", "待补充核心判断");
            let notes = text_field(slide, "notes", "待补充讲述提示");
            let visual = text_field(slide, "visualTreatment", "遵循整套视觉总则");
            let source = text_field(slide, "sourceNote", "待核验");
            let bullets = legacy_slide_bullets(slide);
            out.push_str(&format!(
                "<!-- ppt:slide id=\"{}\" revision=\"1\" -->\n### P{:02}｜{}\n\n#### 核心判断\n\n{}\n\n#### 页面文案\n\n{}\n\n#### 证据与来源\n\n- {}\n\n#### 视觉表达\n\n{}\n\n#### 讲述提示\n\n{}\n\n",
                markdown_scalar(&slide_id),
                index + 1,
                markdown_text(&slide_title),
                markdown_text(&claim),
                bullets,
                markdown_text(&source),
                markdown_text(&visual),
                markdown_text(&notes),
            ));
        }
    }
    out
}

fn legacy_slide_bullets(slide: &Value) -> String {
    let direct = slide.get("bullets").and_then(Value::as_array);
    let from_elements = slide
        .get("elements")
        .and_then(Value::as_array)
        .and_then(|elements| {
            elements
                .iter()
                .find(|element| element.get("type").and_then(Value::as_str) == Some("list"))
                .and_then(|element| element.get("items"))
                .and_then(Value::as_array)
        });
    let bullets = direct.or(from_elements);
    let values = bullets
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("- {}", markdown_text(value)))
        .collect::<Vec<_>>();
    if values.is_empty() {
        "- 待补充页面文案".to_string()
    } else {
        values.join("\n")
    }
}

fn text_field(value: &Value, key: &str, fallback: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn markdown_text(value: &str) -> String {
    value.replace('\r', "").trim().to_string()
}

fn markdown_scalar(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
        .collect::<String>()
}

fn normalize_document_content(content: &str) -> String {
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    format!("{}\n", normalized.trim_end())
}

fn validate_manuscript(content: &str) -> Vec<ManuscriptDiagnostic> {
    let marker = slide_marker_regex();
    let lines = content.lines().collect::<Vec<_>>();
    let mut diagnostics = Vec::new();
    let mut ids = HashSet::new();
    let mut slide_markers = Vec::new();

    if !lines.iter().any(|line| line.starts_with("# ")) {
        diagnostics.push(error_diagnostic(
            "missing_document_title",
            "manuscript.md requires one H1 document title",
            None,
        ));
    }
    if !lines.iter().any(|line| line.starts_with("## ")) {
        diagnostics.push(error_diagnostic(
            "missing_chapter",
            "manuscript.md requires at least one H2 chapter",
            None,
        ));
    }

    for (index, line) in lines.iter().enumerate() {
        let Some(captures) = marker.captures(line) else {
            if line.contains("ppt:slide") {
                diagnostics.push(error_diagnostic(
                    "invalid_slide_marker",
                    "Invalid ppt:slide marker; expected id, numeric revision, and optional quoted attributes",
                    Some(index + 1),
                ));
            }
            continue;
        };
        let id = captures
            .get(1)
            .map(|value| value.as_str())
            .unwrap_or_default();
        if !ids.insert(id.to_string()) {
            diagnostics.push(error_diagnostic(
                "duplicate_slide_id",
                &format!("Duplicate ppt:slide id '{id}'"),
                Some(index + 1),
            ));
        }
        slide_markers.push((index, id.to_string()));
    }

    for (index, line) in lines.iter().enumerate() {
        if !line.starts_with("### ") {
            continue;
        }
        let previous_nonempty = lines[..index]
            .iter()
            .rev()
            .find(|candidate| !candidate.trim().is_empty());
        if !previous_nonempty.is_some_and(|candidate| marker.is_match(candidate)) {
            diagnostics.push(error_diagnostic(
                "orphan_slide_heading",
                "Every H3 slide heading must be immediately preceded by a valid ppt:slide marker, ignoring blank lines",
                Some(index + 1),
            ));
        }
    }

    for (position, (start, id)) in slide_markers.iter().enumerate() {
        let end = slide_markers
            .get(position + 1)
            .map(|(next, _)| *next)
            .unwrap_or(lines.len());
        let section = &lines[*start + 1..end];
        if !section.iter().any(|line| line.starts_with("### ")) {
            diagnostics.push(error_diagnostic(
                "missing_slide_heading",
                &format!("Slide '{id}' requires an H3 heading after its marker"),
                Some(*start + 1),
            ));
        }
        for required in ["核心判断", "页面文案", "证据与来源", "视觉表达", "讲述提示"]
        {
            if !section
                .iter()
                .any(|line| line.trim() == format!("#### {required}"))
            {
                diagnostics.push(error_diagnostic(
                    "missing_slide_section",
                    &format!("Slide '{id}' requires section '#### {required}'"),
                    Some(*start + 1),
                ));
            }
        }
    }
    diagnostics
}

fn error_diagnostic(code: &str, message: &str, line: Option<usize>) -> ManuscriptDiagnostic {
    ManuscriptDiagnostic {
        severity: "error".to_string(),
        code: code.to_string(),
        message: message.to_string(),
        line,
    }
}

fn slide_marker_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r#"^<!--\s*ppt:slide\s+id="([A-Za-z0-9._-]+)"\s+revision="[0-9]+"(?:\s+[A-Za-z][A-Za-z0-9_.:-]*="[^"\r\n]*")*\s*-->$"#,
        )
        .expect("valid PPT manuscript slide marker regex")
    })
}

fn content_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("sha256:{:x}", hasher.finalize())
}

fn history_path(deck_dir: &Path, revision: u64, hash: &str) -> PathBuf {
    let short_hash = hash.strip_prefix("sha256:").unwrap_or(hash);
    deck_dir
        .join(HISTORY_DIR)
        .join(format!("manuscript-{revision:08}-{short_hash}.md"))
}

fn atomic_text_backup_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("manuscript.md");
    path.parent()
        .unwrap_or_else(|| Path::new("."))
        .join(format!(".{name}.backup"))
}

async fn replace_text_with_backup(path: &Path, backup: &Path, content: &str) -> CoreResult<()> {
    let parent = path.parent().ok_or_else(|| {
        CoreError::validation(format!("Manuscript path has no parent: {}", path.display()))
    })?;
    fs::create_dir_all(parent).await?;
    let temp = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("manuscript"),
        uuid::Uuid::new_v4()
    ));
    write_new_synced_file(&temp, content.as_bytes()).await?;
    remove_if_present(backup).await?;
    let had_previous = fs::try_exists(path).await?;
    if had_previous {
        fs::rename(path, backup).await?;
    }
    if let Err(error) = fs::rename(&temp, path).await {
        if had_previous {
            let _ = fs::rename(backup, path).await;
        }
        let _ = remove_if_present(&temp).await;
        return Err(error.into());
    }
    sync_directory_best_effort(parent).await;
    Ok(())
}

async fn restore_text_backup(path: &Path, backup: &Path) {
    if fs::try_exists(backup).await.unwrap_or(false) {
        let _ = remove_if_present(path).await;
        let _ = fs::rename(backup, path).await;
    }
}

async fn write_new_synced_file(path: &Path, bytes: &[u8]) -> CoreResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    match OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .await
    {
        Ok(mut file) => {
            file.write_all(bytes).await?;
            file.flush().await?;
            file.sync_all().await?;
            Ok(())
        }
        Err(error) if error.kind() == ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(error.into()),
    }
}

async fn file_matches_hash(path: &Path, expected_hash: &str) -> CoreResult<bool> {
    match fs::read_to_string(path).await {
        Ok(content) => Ok(content_hash(&content) == expected_hash),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

async fn remove_if_present(path: &Path) -> CoreResult<()> {
    match fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

async fn sync_directory_best_effort(path: &Path) {
    if let Ok(directory) = fs::File::open(path).await {
        let _ = directory.sync_all().await;
    }
}

fn normalize_idempotency_key(value: Option<&str>) -> CoreResult<Option<String>> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if value.len() > 160
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err(CoreError::validation(
            "ppt.manuscript.idempotency_key_invalid".to_string(),
        ));
    }
    Ok(Some(value.to_string()))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
}

fn document_lock(path: &Path) -> Arc<Mutex<()>> {
    static LOCKS: OnceLock<StdMutex<HashMap<PathBuf, Weak<Mutex<()>>>>> = OnceLock::new();
    let locks = LOCKS.get_or_init(|| StdMutex::new(HashMap::new()));
    let mut locks = locks
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(existing) = locks.get(path).and_then(Weak::upgrade) {
        return existing;
    }
    let lock = Arc::new(Mutex::new(()));
    locks.insert(path.to_path_buf(), Arc::downgrade(&lock));
    lock
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::PathManager;
    use serde_json::json;

    fn service(test_name: &str) -> (PptDeckService, WorkId, String) {
        let root = std::env::temp_dir().join(format!(
            "sparo-ppt-deck-{test_name}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let storage =
            ProductAppRuntimeStorage::new(Arc::new(PathManager::with_user_root_for_tests(root)));
        (
            PptDeckService::new(storage),
            WorkId::parse("work_ppt_test").expect("work id"),
            "runtime_ppt_test".to_string(),
        )
    }

    #[tokio::test]
    async fn initializes_manuscript_from_existing_visual_state_without_changing_slide_ids() {
        let (service, work_id, runtime_id) = service("migration");
        service
            .runtime_storage
            .set_storage(
                &work_id,
                &runtime_id,
                LEGACY_STATE_KEY,
                json!({
                    "sessionId": "deck-1",
                    "title": "Strategy",
                    "brief": { "topic": "AI strategy" },
                    "slides": [{
                        "id": "slide-stable-1",
                        "title": "Decision",
                        "claim": "Invest now",
                        "bullets": ["Proof one", "Proof two"],
                        "sourceNote": "Source A",
                        "visualTreatment": "comparison",
                        "notes": "Explain the tradeoff"
                    }]
                }),
            )
            .await
            .expect("legacy state");

        let document = service
            .read_manuscript(&work_id, &runtime_id)
            .await
            .expect("manuscript");

        assert_eq!(document.deck_id, "deck-1");
        assert_eq!(document.revision, 1);
        assert!(document.content.contains("id=\"slide-stable-1\""));
        assert!(document.content.contains("### P01｜Decision"));
        assert!(document.diagnostics.is_empty());
    }

    #[tokio::test]
    async fn stale_revision_or_hash_is_rejected() {
        let (service, work_id, runtime_id) = service("cas");
        let current = service
            .read_manuscript(&work_id, &runtime_id)
            .await
            .expect("initial document");
        let error = service
            .commit_manuscript(
                &work_id,
                &runtime_id,
                ManuscriptCommitRequest {
                    content: current.content.clone(),
                    expected_revision: current.revision + 1,
                    expected_content_hash: current.content_hash.clone(),
                    idempotency_key: None,
                },
            )
            .await
            .expect_err("stale revision");

        assert!(error.to_string().contains("revision_conflict"));
    }

    #[tokio::test]
    async fn invalid_markdown_never_becomes_canonical() {
        let (service, work_id, runtime_id) = service("invalid");
        let current = service
            .read_manuscript(&work_id, &runtime_id)
            .await
            .expect("initial document");
        let error = service
            .commit_manuscript(
                &work_id,
                &runtime_id,
                ManuscriptCommitRequest {
                    content: "# Broken\n\n<!-- ppt:slide id=\"slide-1\" revision=\"1\" -->\n### P01｜Broken\n".to_string(),
                    expected_revision: current.revision,
                    expected_content_hash: current.content_hash.clone(),
                    idempotency_key: None,
                },
            )
            .await
            .expect_err("invalid document");

        assert!(error.to_string().contains("ppt.manuscript.invalid"));
        assert_eq!(
            service
                .read_manuscript(&work_id, &runtime_id)
                .await
                .expect("canonical document")
                .content_hash,
            current.content_hash
        );
    }

    #[tokio::test]
    async fn idempotency_replay_returns_the_original_historical_document() {
        let (service, work_id, runtime_id) = service("idempotency");
        let current = service
            .read_manuscript(&work_id, &runtime_id)
            .await
            .expect("initial document");
        let changed = current.content.replacen("围绕主题", "围绕关键决策", 1);
        let request = ManuscriptCommitRequest {
            content: changed,
            expected_revision: current.revision,
            expected_content_hash: current.content_hash,
            idempotency_key: Some("commit-1".to_string()),
        };
        let committed = service
            .commit_manuscript(&work_id, &runtime_id, request.clone())
            .await
            .expect("commit");
        let later = service
            .commit_manuscript(
                &work_id,
                &runtime_id,
                ManuscriptCommitRequest {
                    content: format!(
                        "{}\n\n## Later update\n",
                        committed.document.content.trim_end()
                    ),
                    expected_revision: committed.document.revision,
                    expected_content_hash: committed.document.content_hash.clone(),
                    idempotency_key: Some("commit-2".to_string()),
                },
            )
            .await
            .expect("later commit");
        let replay = service
            .commit_manuscript(&work_id, &runtime_id, request)
            .await
            .expect("replay");

        assert!(!committed.replayed);
        assert!(replay.replayed);
        assert_eq!(replay.document, committed.document);
        assert!(later.document.revision > replay.document.revision);
    }

    #[tokio::test]
    async fn no_op_commit_persists_its_idempotency_key() {
        let (service, work_id, runtime_id) = service("idempotency-no-op");
        let current = service
            .read_manuscript(&work_id, &runtime_id)
            .await
            .expect("initial document");
        let current = service
            .commit_manuscript(
                &work_id,
                &runtime_id,
                ManuscriptCommitRequest {
                    content: current.content.clone(),
                    expected_revision: current.revision,
                    expected_content_hash: current.content_hash,
                    idempotency_key: None,
                },
            )
            .await
            .expect("normalize initial document")
            .document;
        let no_op_request = ManuscriptCommitRequest {
            content: current.content.clone(),
            expected_revision: current.revision,
            expected_content_hash: current.content_hash.clone(),
            idempotency_key: Some("no-op-1".to_string()),
        };
        let no_op = service
            .commit_manuscript(&work_id, &runtime_id, no_op_request.clone())
            .await
            .expect("no-op commit");
        assert!(no_op.replayed);

        let changed = service
            .commit_manuscript(
                &work_id,
                &runtime_id,
                ManuscriptCommitRequest {
                    content: format!("{}\n\n## Changed later\n", current.content.trim_end()),
                    expected_revision: current.revision,
                    expected_content_hash: current.content_hash.clone(),
                    idempotency_key: Some("changed-later".to_string()),
                },
            )
            .await
            .expect("changed commit");
        assert!(changed.document.revision > current.revision);

        let replay = service
            .commit_manuscript(&work_id, &runtime_id, no_op_request)
            .await
            .expect("persisted no-op replay");
        assert!(replay.replayed);
        assert_eq!(replay.document, current);
    }

    #[test]
    fn old_idempotency_metadata_without_timestamp_remains_readable() {
        let metadata: DeckProjectMetadata = serde_json::from_value(json!({
            "schemaVersion": 1,
            "deckId": "deck-1",
            "manuscriptRevision": 2,
            "manuscriptContentHash": "sha256:current",
            "updatedAtMs": 42,
            "idempotency": {
                "legacy-key": {
                    "revision": 1,
                    "contentHash": "sha256:legacy"
                }
            }
        }))
        .expect("legacy metadata");

        assert_eq!(metadata.idempotency["legacy-key"].updated_at_ms, 0);
    }

    #[test]
    fn slide_marker_accepts_extra_quoted_attributes_after_revision() {
        let content = manuscript_from_legacy_state(
            "deck-1",
            &json!({
                "slides": [{ "id": "slide-1", "title": "Decision" }]
            }),
        )
        .replacen(
            "<!-- ppt:slide id=\"slide-1\" revision=\"1\" -->",
            "<!-- ppt:slide id=\"slide-1\" revision=\"1\" source=\"agent\" data.locked=\"false\" -->",
            1,
        );

        assert!(validate_manuscript(&content).is_empty());
    }

    #[test]
    fn invalid_slide_marker_and_orphan_slide_heading_are_reported() {
        let content = manuscript_from_legacy_state(
            "deck-1",
            &json!({
                "slides": [{ "id": "slide-1", "title": "Decision" }]
            }),
        )
        .replacen(
            "<!-- ppt:slide id=\"slide-1\" revision=\"1\" -->",
            "<!-- ppt:slide id=\"slide-1\" revision=\"draft\" -->",
            1,
        );
        let diagnostics = validate_manuscript(&content);

        assert!(diagnostics
            .iter()
            .any(|item| item.code == "invalid_slide_marker"));
        assert!(diagnostics
            .iter()
            .any(|item| item.code == "orphan_slide_heading"));
    }

    #[test]
    fn slide_heading_rejects_intervening_nonempty_content_after_marker() {
        let content = manuscript_from_legacy_state(
            "deck-1",
            &json!({
                "slides": [{ "id": "slide-1", "title": "Decision" }]
            }),
        )
        .replacen(
            "<!-- ppt:slide id=\"slide-1\" revision=\"1\" -->\n### ",
            "<!-- ppt:slide id=\"slide-1\" revision=\"1\" -->\nintervening text\n### ",
            1,
        );
        let diagnostics = validate_manuscript(&content);

        assert!(diagnostics
            .iter()
            .any(|item| item.code == "orphan_slide_heading"));
    }

    #[tokio::test]
    async fn concurrent_commits_allow_only_one_cas_winner() {
        let (service, work_id, runtime_id) = service("concurrency");
        let current = service
            .read_manuscript(&work_id, &runtime_id)
            .await
            .expect("initial document");
        let first = service.clone();
        let second = service.clone();
        let first_work = work_id.clone();
        let second_work = work_id.clone();
        let first_runtime = runtime_id.clone();
        let second_runtime = runtime_id.clone();
        let first_request = ManuscriptCommitRequest {
            content: current.content.replacen("围绕主题", "围绕方向 A", 1),
            expected_revision: current.revision,
            expected_content_hash: current.content_hash.clone(),
            idempotency_key: Some("parallel-a".to_string()),
        };
        let second_request = ManuscriptCommitRequest {
            content: current.content.replacen("围绕主题", "围绕方向 B", 1),
            expected_revision: current.revision,
            expected_content_hash: current.content_hash,
            idempotency_key: Some("parallel-b".to_string()),
        };

        let (left, right) = tokio::join!(
            first.commit_manuscript(&first_work, &first_runtime, first_request),
            second.commit_manuscript(&second_work, &second_runtime, second_request)
        );

        assert_ne!(left.is_ok(), right.is_ok());
        let error = left.err().or_else(|| right.err()).expect("one conflict");
        assert!(error.to_string().contains("revision_conflict"));
    }
}
