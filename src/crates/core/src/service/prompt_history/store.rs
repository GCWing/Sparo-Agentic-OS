use super::types::{
    PromptHistoryEvent, PromptHistoryQuery, PromptHistorySource, PromptHistorySummary,
    PromptLineage,
};
use crate::infrastructure::get_path_manager_arc;
use crate::util::errors::{BitFunError, BitFunResult};
use chrono::{Datelike, DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use tokio::sync::Mutex;

static WORKSPACE_WRITE_LOCKS: OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = OnceLock::new();

pub struct PromptHistoryStore;

impl PromptHistoryStore {
    /// History root directory
    pub fn history_dir(workspace_path: &Path) -> PathBuf {
        get_path_manager_arc()
            .project_runtime_root(workspace_path)
            .join("prompt_library")
    }

    /// Events directory
    pub fn events_dir(workspace_path: &Path) -> PathBuf {
        Self::history_dir(workspace_path).join("events")
    }

    /// Monthly file path
    pub fn month_file(workspace_path: &Path, year: u32, month: u32) -> PathBuf {
        Self::events_dir(workspace_path)
            .join(format!("{:04}-{:02}.jsonl", year, month))
    }

    /// Index file path
    pub fn index_path(workspace_path: &Path) -> PathBuf {
        Self::history_dir(workspace_path).join("index.json")
    }

    /// Get workspace-level write lock for best-effort atomicity of events + index
    async fn get_workspace_write_lock(workspace_path: &Path) -> Arc<Mutex<()>> {
        let registry = WORKSPACE_WRITE_LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
        let mut guard = registry.lock().await;
        guard
            .entry(workspace_path.to_path_buf())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    /// Extract (year, month) from an RFC3339 timestamp string
    fn parse_year_month(rfc3339: &str) -> Option<(u32, u32)> {
        let dt = DateTime::parse_from_rfc3339(rfc3339).ok()?;
        Some((dt.year() as u32, dt.month()))
    }

    /// Extract month from event.created_at
    fn event_month(event: &PromptHistoryEvent) -> BitFunResult<(u32, u32)> {
        Self::parse_year_month(&event.created_at).ok_or_else(|| {
            BitFunError::validation("Invalid created_at timestamp")
        })
    }

    /// Compute SHA256 hash of prompt text
    pub fn prompt_hash(text: &str) -> String {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(text.trim().as_bytes());
        hex::encode(hasher.finalize())
    }

    // ============ Write ============

    /// Record a new chat input event
    pub async fn record_chat_input(
        workspace_path: impl Into<String>,
        session_id: impl Into<String>,
        turn_id: Option<String>,
        agent_type: impl Into<String>,
        text: impl Into<String>,
    ) -> BitFunResult<PromptHistoryEvent> {
        let workspace_path = workspace_path.into();
        let text = text.into();
        if text.trim().is_empty() {
            return Err(BitFunError::validation("Prompt text is required"));
        }

        let event = PromptHistoryEvent {
            id: format!("prompt_{}", uuid::Uuid::new_v4().simple()),
            session_id: session_id.into(),
            session_name: None,
            turn_id,
            created_at: Utc::now().to_rfc3339(),
            updated_at: None,
            source: PromptHistorySource::ChatInput,
            text: text.clone(),
            prompt_hash: Self::prompt_hash(&text),
            agent_type: agent_type.into(),
            pinned: false,
            after_commit_hash: capture_git_head(Path::new(&workspace_path)),
            git_branch_at_created: capture_git_branch(Path::new(&workspace_path)),
            forked_from_event_id: None,
            model_id: None,
            image_context_count: 0,
            supersedes: None,
        };

        Self::record_event(Path::new(&workspace_path), &event).await?;
        Ok(event)
    }

    /// Record an event (new or tombstone update)
    pub async fn record_event(
        workspace_path: &Path,
        event: &PromptHistoryEvent,
    ) -> BitFunResult<()> {
        let (year, month) = Self::event_month(event)?;
        let month_key = format!("{:04}-{:02}", year, month);
        let file_path = Self::month_file(workspace_path, year, month);

        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let line = serde_json::to_string(event)?;
        let line_len = line.len() as u64;

        let lock = Self::get_workspace_write_lock(workspace_path).await;
        let _guard = lock.lock().await;

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&file_path)?;
        writeln!(file, "{}", line)?;

        Self::increment_index(workspace_path, &month_key, &file_path, line_len, event)?;

        Ok(())
    }

    /// Toggle pinned status via tombstone
    pub async fn toggle_pin(
        workspace_path: &Path,
        event_id: &str,
        pinned: bool,
    ) -> BitFunResult<PromptHistoryEvent> {
        let existing = Self::get_event(workspace_path, event_id)?;
        let (year, month) = Self::event_month(&existing)?;
        let month_key = format!("{:04}-{:02}", year, month);
        let file_path = Self::month_file(workspace_path, year, month);

        let mut updated = existing.clone();
        updated.pinned = pinned;
        updated.updated_at = Some(Utc::now().to_rfc3339());
        updated.supersedes = Some(event_id.to_string());

        let line = serde_json::to_string(&updated)?;
        let line_len = line.len() as u64;

        let lock = Self::get_workspace_write_lock(workspace_path).await;
        let _guard = lock.lock().await;

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&file_path)?;
        writeln!(file, "{}", line)?;

        Self::increment_index(workspace_path, &month_key, &file_path, line_len, &updated)?;

        Ok(updated)
    }

    // ============ Read + Deduplication ============

    /// Read a single month file and deduplicate tombstone entries.
    /// When the same id appears multiple times, the row with `supersedes` pointing
    /// to the older row wins.
    fn read_events_deduplicated(file_path: &Path) -> BitFunResult<Vec<PromptHistoryEvent>> {
        if !file_path.exists() {
            return Ok(Vec::new());
        }

        let mut latest_by_id: HashMap<String, PromptHistoryEvent> = HashMap::new();
        for line in BufReader::new(fs::File::open(file_path)?).lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            let event: PromptHistoryEvent = match serde_json::from_str(&line) {
                Ok(e) => e,
                Err(err) => {
                    log::warn!("Failed to parse event: {}", err);
                    continue;
                }
            };

            latest_by_id
                .entry(event.id.clone())
                .and_modify(|existing| {
                    if event.supersedes.as_deref() == Some(&existing.id) {
                        *existing = event.clone();
                    }
                })
                .or_insert(event);
        }

        Ok(latest_by_id.into_values().collect())
    }

    // ============ Query ============

    /// Get a single event by id.
    /// Uses event_map for O(1) file lookup when available (schema v2+),
    /// falls back to full scan for legacy indexes.
    pub fn get_event(
        workspace_path: &Path,
        event_id: &str,
    ) -> BitFunResult<PromptHistoryEvent> {
        let index = Self::load_index(workspace_path)?;

        // Fast path: event_map lookup (schema v2+)
        if let Some(location) = index.event_map.get(event_id) {
            if let Some(file_entry) = index.files.iter().find(|f| f.key == location.file_key) {
                let file_path = Self::history_dir(workspace_path).join(&file_entry.path);
                if file_path.exists() {
                    let events = Self::read_events_deduplicated(&file_path)?;
                    if let Some(event) = events.into_iter().find(|e| e.id == event_id) {
                        return Ok(event);
                    }
                }
            }
            // event_map points to a file but event not found after dedup;
            // fall through to full scan in case of stale index.
        }

        // Fallback: scan all month files (legacy index or stale event_map)
        let mut files: Vec<_> = index.files.iter().collect();
        files.sort_by(|a, b| b.key.cmp(&a.key));

        for file_entry in &files {
            let file_path = Self::history_dir(workspace_path).join(&file_entry.path);
            if !file_path.exists() {
                continue;
            }
            let events = Self::read_events_deduplicated(&file_path)?;
            for event in events {
                if event.id == event_id {
                    return Ok(event);
                }
            }
        }
        Err(BitFunError::NotFound(format!("Event not found: {}", event_id)))
    }

    /// List history events with filtering and pagination.
    /// Reads month files in reverse-chronological order, using branch-level index
    /// pruning to skip files that don't contain events for the requested branch.
    pub fn list(
        workspace_path: &Path,
        query: PromptHistoryQuery,
    ) -> BitFunResult<PromptHistorySummary> {
        let index = Self::load_index(workspace_path)?;
        let q = query
            .query
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_lowercase);
        let session_filter = query
            .session_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let agent_filter = query
            .agent_type
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let branch_filter = query
            .branch
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let limit = query.limit.unwrap_or(100).clamp(1, 500);

        let from_date = query.from_date.as_deref().and_then(|s| {
            DateTime::parse_from_rfc3339(s).ok().map(|d| d.with_timezone(&Utc))
        });
        let to_date = query.to_date.as_deref().and_then(|s| {
            DateTime::parse_from_rfc3339(s).ok().map(|d| d.with_timezone(&Utc))
        });

        let mut events = Vec::new();

        let mut files: Vec<_> = index.files.iter().collect();
        files.sort_by(|a, b| b.key.cmp(&a.key));

        for file_entry in files {
            // Date range pruning at month level
            if let (Some(from), Some(to)) = (from_date, to_date) {
                let file_month_start = format!("{}-01T00:00:00Z", file_entry.key);
                let file_month_end = format!("{}-31T23:59:59Z", file_entry.key);
                if let (Ok(m_start), Ok(m_end)) = (
                    DateTime::parse_from_rfc3339(&file_month_start).map(|d| d.with_timezone(&Utc)),
                    DateTime::parse_from_rfc3339(&file_month_end).map(|d| d.with_timezone(&Utc)),
                ) {
                    if m_end < from || m_start > to {
                        continue;
                    }
                }
            }

            // Branch-level pruning: skip files that don't contain events for the requested branch
            if let Some(br) = branch_filter {
                if !file_entry.branches.is_empty() {
                    // If branches index is populated, check if this file has the branch
                    if !file_entry.branches.contains_key(br) {
                        continue;
                    }
                }
                // If branches index is empty (legacy), we must read the file
            }

            let file_path = Self::history_dir(workspace_path).join(&file_entry.path);
            let file_events = Self::read_events_deduplicated(&file_path)?;

            for event in file_events {
                // Exact date range filter
                if let (Some(from), Some(to)) = (from_date, to_date) {
                    if let Ok(created_at) =
                        DateTime::parse_from_rfc3339(&event.created_at)
                            .map(|d| d.with_timezone(&Utc))
                    {
                        if created_at < from || created_at > to {
                            continue;
                        }
                    }
                }

                if let Some(sid) = session_filter {
                    if event.session_id != sid {
                        continue;
                    }
                }
                if let Some(at) = agent_filter {
                    if event.agent_type != at {
                        continue;
                    }
                }
                if let Some(p) = query.pinned {
                    if event.pinned != p {
                        continue;
                    }
                }
                if let Some(br) = branch_filter {
                    if event.git_branch_at_created.as_deref() != Some(br) {
                        continue;
                    }
                }
                if let Some(hash) = &query.prompt_hash {
                    if &event.prompt_hash != hash {
                        continue;
                    }
                }
                if let Some(ref q) = q {
                    let hay = format!(
                        "{} {} {}",
                        event.text, event.agent_type, event.session_id
                    )
                    .to_lowercase();
                    if !hay.contains(q) {
                        continue;
                    }
                }

                events.push(event);
            }

            // Stop loading earlier months if we have enough and no filter that requires full scan
            if events.len() >= limit
                && query.query.is_none()
                && query.pinned.is_none()
                && query.prompt_hash.is_none()
                && from_date.is_none()
                && to_date.is_none()
            {
                break;
            }
        }

        events.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        let total = events.len();
        events.truncate(limit);

        Ok(PromptHistorySummary { total, events })
    }

    /// List all events across all projects
    pub fn list_all_projects(
        query: PromptHistoryQuery,
    ) -> BitFunResult<PromptHistorySummary> {
        let projects_root = get_path_manager_arc().projects_root();
        if !projects_root.exists() {
            return Ok(PromptHistorySummary {
                total: 0,
                events: Vec::new(),
            });
        }

        let mut files = Vec::new();
        for entry in fs::read_dir(&projects_root)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            // Use the prompt_history events.jsonl from the old location for cross-project listing
            let file = entry
                .path()
                .join("prompt_library")
                .join("events");
            if file.exists() {
                for entry in fs::read_dir(&file).into_iter().flatten() {
                    if let Ok(entry) = entry {
                        if entry.path().extension().and_then(|s| s.to_str()) == Some("jsonl") {
                            files.push(entry.path());
                        }
                    }
                }
            }
        }

        // Fallback: also check old prompt_history dir
        for entry in fs::read_dir(&projects_root)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let file = entry.path().join("prompt_history").join("events.jsonl");
            if file.exists() {
                files.push(file);
            }
        }

        let workspace_path = get_path_manager_arc().projects_root().join("_all_");
        Self::list_from_files(files, query, &workspace_path)
    }

    /// List events from a set of raw files (used by list_all_projects and legacy support)
    fn list_from_files(
        files: Vec<PathBuf>,
        query: PromptHistoryQuery,
        _workspace_path: &Path,
    ) -> BitFunResult<PromptHistorySummary> {
        let q = query
            .query
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_lowercase);
        let session_filter = query
            .session_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let agent_filter = query
            .agent_type
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let branch_filter = query
            .branch
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let limit = query.limit.unwrap_or(100).clamp(1, 500);

        let mut events = Vec::new();
        for file in files {
            for line in BufReader::new(fs::File::open(&file)?).lines() {
                let line = line?;
                if line.trim().is_empty() {
                    continue;
                }
                let event: PromptHistoryEvent = match serde_json::from_str(&line) {
                    Ok(event) => event,
                    Err(error) => {
                        log::warn!("Failed to parse prompt history event: {}", error);
                        continue;
                    }
                };
                if let Some(session_id) = session_filter {
                    if event.session_id != session_id {
                        continue;
                    }
                }
                if let Some(agent_type) = agent_filter {
                    if event.agent_type != agent_type {
                        continue;
                    }
                }
                if let Some(pinned) = query.pinned {
                    if event.pinned != pinned {
                        continue;
                    }
                }
                if let Some(br) = branch_filter {
                    if event.git_branch_at_created.as_deref() != Some(br) {
                        continue;
                    }
                }
                if let Some(hash) = &query.prompt_hash {
                    if &event.prompt_hash != hash {
                        continue;
                    }
                }
                if let Some(q) = &q {
                    let hay = format!(
                        "{} {} {}",
                        event.text, event.agent_type, event.session_id
                    )
                    .to_lowercase();
                    if !hay.contains(q) {
                        continue;
                    }
                }
                events.push(event);
            }
        }
        events.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        let total = events.len();
        events.truncate(limit);
        Ok(PromptHistorySummary { total, events })
    }

    // ============ Lineage ============

    /// Get the full lineage chain for an event
    pub fn get_lineage(
        workspace_path: &Path,
        event_id: &str,
    ) -> BitFunResult<PromptLineage> {
        let event = Self::get_event(workspace_path, event_id)?;

        // Trace ancestors upward
        let mut ancestors = Vec::new();
        let mut current_id = event.forked_from_event_id.clone();
        while let Some(parent_id) = current_id {
            match Self::get_event(workspace_path, &parent_id) {
                Ok(parent) => {
                    ancestors.push(parent.id.clone());
                    current_id = parent.forked_from_event_id.clone();
                }
                Err(_) => break,
            }
        }
        ancestors.reverse();

        // Find descendants
        let descendants = Self::find_descendants(workspace_path, event_id)?;

        // Find siblings (same prompt_hash, excluding self)
        let siblings = Self::list(
            workspace_path,
            PromptHistoryQuery {
                prompt_hash: Some(event.prompt_hash.clone()),
                ..Default::default()
            },
        )
        .map(|s| {
            s.events
                .into_iter()
                .filter(|e| e.id != event_id)
                .map(|e| e.id)
                .collect()
        })
        .unwrap_or_default();

        Ok(PromptLineage {
            event,
            ancestors,
            descendants: descendants.into_iter().map(|e| e.id).collect(),
            siblings,
        })
    }

    fn find_descendants(
        workspace_path: &Path,
        event_id: &str,
    ) -> BitFunResult<Vec<PromptHistoryEvent>> {
        let index = Self::load_index(workspace_path)?;
        let mut descendants = Vec::new();
        for file_entry in &index.files {
            let file_path = Self::history_dir(workspace_path).join(&file_entry.path);
            let events = Self::read_events_deduplicated(&file_path)?;
            for event in events {
                if event.forked_from_event_id.as_deref() == Some(event_id) {
                    descendants.push(event);
                }
            }
        }
        Ok(descendants)
    }

    // ============ Index Management ============

    fn increment_index(
        workspace_path: &Path,
        key: &str,
        file_path: &Path,
        line_bytes: u64,
        event: &PromptHistoryEvent,
    ) -> BitFunResult<()> {
        let mut index = Self::load_index_or_rebuild(workspace_path)?;

        if let Some(existing) = index.files.iter_mut().find(|f| f.key == key) {
            existing.event_count += 1;
            existing.byte_size += line_bytes as usize;

            let branch_name = event
                .git_branch_at_created
                .clone()
                .unwrap_or_default();
            let branch_stats = existing
                .branches
                .entry(branch_name)
                .or_insert_with(|| BranchStats {
                    count: 0,
                    latest_at: String::new(),
                });
            branch_stats.count += 1;
            if event.created_at > branch_stats.latest_at {
                branch_stats.latest_at = event.created_at.clone();
            }
        } else {
            let meta = fs::metadata(file_path)?;
            let branch_name = event
                .git_branch_at_created
                .clone()
                .unwrap_or_default();
            let mut branches = HashMap::new();
            branches.insert(
                branch_name,
                BranchStats {
                    count: 1,
                    latest_at: event.created_at.clone(),
                },
            );
            index.files.push(PromptHistoryIndexEntry {
                key: key.to_string(),
                path: format!("events/{}.jsonl", key),
                event_count: 1,
                byte_size: meta.len() as usize,
                branches,
            });
        }

        index
            .event_map
            .insert(event.id.clone(), EventLocation { file_key: key.to_string() });

        index.total_events = index.files.iter().map(|f| f.event_count).sum();
        index.updated_at = Some(Utc::now().to_rfc3339());

        let content = serde_json::to_string_pretty(&index)?;
        Self::write_index_atomic(workspace_path, &content)?;

        Ok(())
    }

    fn write_index_atomic(workspace_path: &Path, content: &str) -> BitFunResult<()> {
        let path = Self::index_path(workspace_path);
        let parent = path.parent().ok_or_else(|| {
            BitFunError::io("Index path has no parent directory")
        })?;
        fs::create_dir_all(parent)?;

        let tmp_path = path.with_extension(".tmp");
        fs::write(&tmp_path, content)?;
        if path.exists() {
            match fs::remove_file(&path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => {
                    return Err(BitFunError::io(format!(
                        "Failed to remove old index: {}",
                        e
                    )))
                }
            }
        }
        fs::rename(&tmp_path, &path).map_err(|e| {
            BitFunError::io(format!("Failed to rename temp index: {}", e))
        })?;

        Ok(())
    }

    fn load_index(workspace_path: &Path) -> BitFunResult<PromptHistoryIndex> {
        let path = Self::index_path(workspace_path);
        if !path.exists() {
            return Ok(PromptHistoryIndex::default());
        }
        let index: PromptHistoryIndex = serde_json::from_str(&fs::read_to_string(path)?)?;
        Ok(index)
    }

    /// Load index, auto-rebuilding if the schema is outdated (missing event_map/branches).
    fn load_index_or_rebuild(workspace_path: &Path) -> BitFunResult<PromptHistoryIndex> {
        let index = Self::load_index(workspace_path)?;
        if index.schema_version < INDEX_SCHEMA_VERSION && !index.files.is_empty() {
            log::info!(
                "Prompt history index schema {} is outdated (current {}), rebuilding",
                index.schema_version,
                INDEX_SCHEMA_VERSION
            );
            Self::rebuild_index(workspace_path)?;
            return Self::load_index(workspace_path);
        }
        Ok(index)
    }

    /// Rebuild index.json from the events directory.
    /// Used for crash recovery, after migration, or on manual repair.
    /// Generates full event_map and branches data for schema v2.
    pub fn rebuild_index(workspace_path: &Path) -> BitFunResult<()> {
        let mut index = PromptHistoryIndex::default();
        let events_dir = Self::events_dir(workspace_path);
        if !events_dir.exists() {
            let content = serde_json::to_string_pretty(&index)?;
            Self::write_index_atomic(workspace_path, &content)?;
            return Ok(());
        }

        for entry in fs::read_dir(&events_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            if stem.len() != 7 || stem.chars().nth(4) != Some('-') {
                continue;
            }

            let meta = fs::metadata(&path)?;
            let byte_size = meta.len() as usize;

            let mut event_count = 0;
            let mut branches: HashMap<String, BranchStats> = HashMap::new();

            for line in BufReader::new(fs::File::open(&path)?)
                .lines()
                .flatten()
            {
                if line.trim().is_empty() {
                    continue;
                }
                event_count += 1;

                if let Ok(event) = serde_json::from_str::<PromptHistoryEvent>(&line) {
                    index.event_map.insert(
                        event.id.clone(),
                        EventLocation {
                            file_key: stem.to_string(),
                        },
                    );

                    let branch_name = event
                        .git_branch_at_created
                        .clone()
                        .unwrap_or_default();
                    let stats = branches
                        .entry(branch_name)
                        .or_insert_with(|| BranchStats {
                            count: 0,
                            latest_at: String::new(),
                        });
                    stats.count += 1;
                    if event.created_at > stats.latest_at {
                        stats.latest_at = event.created_at.clone();
                    }
                }
            }

            let rel_path = format!("events/{}.jsonl", stem);
            index.files.push(PromptHistoryIndexEntry {
                key: stem.to_string(),
                path: rel_path,
                event_count,
                byte_size,
                branches,
            });
        }

        index.total_events = index.files.iter().map(|f| f.event_count).sum();
        index.updated_at = Some(Utc::now().to_rfc3339());

        let content = serde_json::to_string_pretty(&index)?;
        Self::write_index_atomic(workspace_path, &content)?;

        Ok(())
    }
}

// ============ Index types ============

const INDEX_SCHEMA_VERSION: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptHistoryIndex {
    pub schema_version: u32,
    #[serde(default)]
    pub files: Vec<PromptHistoryIndexEntry>,
    pub total_events: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    /// Event ID -> file key mapping for O(1) lookups.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub event_map: HashMap<String, EventLocation>,
}

impl Default for PromptHistoryIndex {
    fn default() -> Self {
        Self {
            schema_version: INDEX_SCHEMA_VERSION,
            files: Vec::new(),
            total_events: 0,
            updated_at: None,
            event_map: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptHistoryIndexEntry {
    pub key: String,
    pub path: String,
    pub event_count: usize,
    pub byte_size: usize,
    /// Per-branch stats within this file for branch-level pruning.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub branches: HashMap<String, BranchStats>,
}

/// Locates which monthly file an event lives in.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventLocation {
    pub file_key: String,
}

/// Aggregate stats for a single branch within a monthly file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchStats {
    pub count: usize,
    pub latest_at: String,
}

// ============ Git helpers ============

fn capture_git_head(workspace_path: &Path) -> Option<String> {
    let output = std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(workspace_path)
        .env("GIT_PAGER", "cat")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn capture_git_branch(workspace_path: &Path) -> Option<String> {
    let output = std::process::Command::new("git")
        .args(["branch", "--show-current"])
        .current_dir(workspace_path)
        .env("GIT_PAGER", "cat")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}