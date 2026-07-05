//! Product App Runtime Host manager: CRUD, version management, compile on save, and Worker policy.

use crate::app_platform::AppIconSpec;
use crate::infrastructure::events::{emit_global_event, BackendEvent};
use crate::product_app_runtime_host_engine::compiler::compile;
use crate::product_app_runtime_host_engine::permission_policy::resolve_policy;
use crate::product_app_runtime_host_engine::storage::ProductAppRuntimeHostStorage;
use crate::product_app_runtime_host_engine::types::{
    ProductAppRuntimeHostAiContext, ProductAppRuntimeHostBackendBinding, ProductAppRuntimeHostI18n,
    ProductAppRuntimeHostInteraction, ProductAppRuntimeHostPermissions,
    ProductAppRuntimeHostRuntimeIssue, ProductAppRuntimeHostRuntimeIssueSeverity,
    ProductAppRuntimeHostRuntimeLog, ProductAppRuntimeHostRuntimeLogLevel,
    ProductAppRuntimeHostRuntimeState, ProductAppRuntimeHostSource, ProductAppRuntimeHostSurface,
    ProductAppRuntimeHostSurfaceMeta,
};
use crate::error::{CoreError, CoreResult};
use chrono::Utc;
use serde_json::json;
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use tokio::io::AsyncWriteExt;
use tokio::sync::RwLock;
use uuid::Uuid;

const MAX_RUNTIME_ISSUES_PER_APP: usize = 50;
const MAX_RUNTIME_LOGS_PER_APP: usize = 200;
const MAX_RUNTIME_LOG_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_RUNTIME_MESSAGE_CHARS: usize = 4_000;
const MAX_RUNTIME_STACK_CHARS: usize = 8_000;
const RECENT_PRODUCT_APP_RUNTIME_HOSTS_FILE: &str = "recent_opened.json";
const MAX_RECENT_PRODUCT_APP_RUNTIME_HOSTS: usize = 12;
const MAX_RUNTIME_DETAILS_CHARS: usize = 8_000;

static GLOBAL_PRODUCT_APP_RUNTIME_HOST_MANAGER: OnceLock<Arc<ProductAppRuntimeHostManager>> =
    OnceLock::new();

/// Initialize the global ProductAppRuntimeHostManager (called once at startup from Tauri app_state).
pub fn initialize_global_product_app_runtime_host_manager(
    manager: Arc<ProductAppRuntimeHostManager>,
) {
    let _ = GLOBAL_PRODUCT_APP_RUNTIME_HOST_MANAGER.set(manager);
}

/// Get the global ProductAppRuntimeHostManager, returning None if not initialized.
pub fn try_get_global_product_app_runtime_host_manager() -> Option<Arc<ProductAppRuntimeHostManager>>
{
    GLOBAL_PRODUCT_APP_RUNTIME_HOST_MANAGER.get().cloned()
}

fn permissions_include_workspace(permissions: &ProductAppRuntimeHostPermissions) -> bool {
    let Some(fs) = permissions.fs.as_ref() else {
        return false;
    };
    fs.read
        .as_ref()
        .is_some_and(|paths| paths.iter().any(|path| path == "{workspace}"))
        || fs
            .write
            .as_ref()
            .is_some_and(|paths| paths.iter().any(|path| path == "{workspace}"))
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut out: String = value.chars().take(max_chars).collect();
    out.push_str("... [truncated]");
    out
}

fn json_equivalent<T: serde::Serialize>(left: &T, right: &T) -> bool {
    match (serde_json::to_value(left), serde_json::to_value(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

fn runtime_diagnostics_key(app_id: &str, runtime_owner_id: Option<&str>) -> String {
    runtime_owner_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(app_id)
        .to_string()
}

fn source_matches(left: &ProductAppRuntimeHostSource, right: &ProductAppRuntimeHostSource) -> bool {
    json_equivalent(left, right)
}

fn permissions_match(
    left: &ProductAppRuntimeHostPermissions,
    right: &ProductAppRuntimeHostPermissions,
) -> bool {
    json_equivalent(left, right)
}

fn backends_match(
    left: &[ProductAppRuntimeHostBackendBinding],
    right: &[ProductAppRuntimeHostBackendBinding],
) -> bool {
    json_equivalent(&left, &right)
}

fn interaction_matches(
    left: &Option<ProductAppRuntimeHostInteraction>,
    right: &Option<ProductAppRuntimeHostInteraction>,
) -> bool {
    json_equivalent(left, right)
}

/// Product App Runtime Host manager: create, read, update, delete, list, compile, rollback.
pub struct ProductAppRuntimeHostManager {
    storage: ProductAppRuntimeHostStorage,
    path_manager: Arc<crate::infrastructure::PathManager>,
    /// User-granted paths per app (for resolve_policy).
    granted_paths: RwLock<HashMap<String, Vec<PathBuf>>>,
    runtime_issues: RwLock<HashMap<String, VecDeque<ProductAppRuntimeHostRuntimeIssue>>>,
    runtime_logs: RwLock<HashMap<String, VecDeque<ProductAppRuntimeHostRuntimeLog>>>,
}

impl ProductAppRuntimeHostManager {
    pub fn new(path_manager: Arc<crate::infrastructure::PathManager>) -> Self {
        let storage = ProductAppRuntimeHostStorage::new(path_manager.clone());
        Self {
            storage,
            path_manager,
            granted_paths: RwLock::new(HashMap::new()),
            runtime_issues: RwLock::new(HashMap::new()),
            runtime_logs: RwLock::new(HashMap::new()),
        }
    }

    fn build_source_revision(version: u32, updated_at: i64) -> String {
        format!("src:{version}:{updated_at}")
    }

    fn build_deps_revision(source: &ProductAppRuntimeHostSource) -> String {
        let mut deps: Vec<String> = source
            .npm_dependencies
            .iter()
            .map(|dep| format!("{}@{}", dep.name, dep.version))
            .collect();
        deps.sort();
        deps.join("|")
    }

    fn node_runtime_enabled(permissions: &ProductAppRuntimeHostPermissions) -> bool {
        permissions.node.as_ref().is_some_and(|node| node.enabled)
    }

    fn normalize_runtime_for_permissions(
        runtime: &mut ProductAppRuntimeHostRuntimeState,
        permissions: &ProductAppRuntimeHostPermissions,
    ) -> bool {
        if Self::node_runtime_enabled(permissions) {
            return false;
        }

        let mut changed = false;
        if runtime.worker_restart_required {
            runtime.worker_restart_required = false;
            changed = true;
        }
        if runtime.deps_dirty {
            runtime.deps_dirty = false;
            changed = true;
        }
        changed
    }

    fn build_runtime_state(
        version: u32,
        updated_at: i64,
        source: &ProductAppRuntimeHostSource,
        permissions: &ProductAppRuntimeHostPermissions,
        deps_dirty: bool,
        worker_restart_required: bool,
    ) -> ProductAppRuntimeHostRuntimeState {
        let node_runtime_enabled = Self::node_runtime_enabled(permissions);
        ProductAppRuntimeHostRuntimeState {
            source_revision: Self::build_source_revision(version, updated_at),
            deps_revision: Self::build_deps_revision(source),
            deps_dirty: node_runtime_enabled && deps_dirty,
            worker_restart_required: node_runtime_enabled && worker_restart_required,
            ui_recompile_required: false,
        }
    }

    fn ensure_runtime_state(app: &mut ProductAppRuntimeHostSurface) -> bool {
        let mut changed = false;
        if app.runtime.source_revision.is_empty() {
            app.runtime.source_revision = Self::build_source_revision(app.version, app.updated_at);
            changed = true;
        }
        let deps_revision = Self::build_deps_revision(&app.source);
        if app.runtime.deps_revision != deps_revision {
            app.runtime.deps_revision = deps_revision;
            changed = true;
        }
        if Self::normalize_runtime_for_permissions(&mut app.runtime, &app.permissions) {
            changed = true;
        }
        changed
    }

    pub fn build_worker_revision(
        &self,
        app: &ProductAppRuntimeHostSurface,
        policy_json: &str,
    ) -> String {
        format!(
            "{}::{}::{}",
            app.runtime.source_revision, app.runtime.deps_revision, policy_json
        )
    }

    fn workspace_dir_string(workspace_root: Option<&Path>) -> String {
        workspace_root
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default()
    }

    pub fn compile_source(
        &self,
        app_id: &str,
        source: &ProductAppRuntimeHostSource,
        permissions: &ProductAppRuntimeHostPermissions,
        runtime: &ProductAppRuntimeHostRuntimeState,
        theme: &str,
        workspace_root: Option<&Path>,
    ) -> CoreResult<String> {
        let app_data_dir = self.path_manager.product_app_runtime_host_dir(app_id);
        let app_data_dir_str = app_data_dir.to_string_lossy().to_string();
        let workspace_dir = Self::workspace_dir_string(workspace_root);

        compile(
            source,
            permissions,
            runtime,
            app_id,
            &app_data_dir_str,
            &workspace_dir,
            theme,
        )
    }

    /// List all ProductAppRuntimeHostSurface metadata.
    pub async fn list(&self) -> CoreResult<Vec<ProductAppRuntimeHostSurfaceMeta>> {
        let ids = self.storage.list_app_ids().await?;
        let mut metas = Vec::with_capacity(ids.len());
        for id in ids {
            if let Ok(mut meta) = self.storage.load_meta(&id).await {
                if Self::normalize_runtime_for_permissions(&mut meta.runtime, &meta.permissions) {
                    if let Ok(mut app) = self.storage.load(&id).await {
                        if Self::ensure_runtime_state(&mut app) {
                            if let Err(e) = self.storage.save(&app).await {
                                log::warn!(
                                    "normalize Product App runtime state '{}' failed: {}",
                                    id,
                                    e
                                );
                            }
                        }
                        meta = ProductAppRuntimeHostSurfaceMeta::from(&app);
                    }
                }
                metas.push(meta);
            }
        }
        metas.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(metas)
    }

    fn recent_opened_path(&self) -> PathBuf {
        self.path_manager
            .product_app_runtime_hosts_dir()
            .join(RECENT_PRODUCT_APP_RUNTIME_HOSTS_FILE)
    }

    async fn save_recent_opened_ids(&self, ids: &[String]) -> CoreResult<()> {
        let root = self.path_manager.product_app_runtime_hosts_dir();
        tokio::fs::create_dir_all(&root).await.map_err(|e| {
            CoreError::io(format!(
                "Failed to create Product Apps dir {}: {}",
                root.display(),
                e
            ))
        })?;
        let path = self.recent_opened_path();
        let content = serde_json::to_string_pretty(ids).map_err(|e| {
            CoreError::parse(format!(
                "Failed to encode recent Product App Runtime hosts: {}",
                e
            ))
        })?;
        tokio::fs::write(&path, content).await.map_err(|e| {
            CoreError::io(format!(
                "Failed to write recent Product App Runtime hosts {}: {}",
                path.display(),
                e
            ))
        })
    }

    /// List recently opened Product App Runtime Host surface IDs, newest first.
    pub async fn list_recent_opened(&self) -> CoreResult<Vec<String>> {
        let path = self.recent_opened_path();
        let content = match tokio::fs::read_to_string(&path).await {
            Ok(content) => content,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => {
                return Err(CoreError::io(format!(
                    "Failed to read recent Product App Runtime hosts {}: {}",
                    path.display(),
                    e
                )));
            }
        };
        let ids: Vec<String> = match serde_json::from_str(&content) {
            Ok(ids) => ids,
            Err(e) => {
                log::warn!("Invalid recent Product App Runtime hosts file: {}", e);
                Vec::new()
            }
        };
        let valid_ids = self.storage.list_app_ids().await?;
        let valid_ids: std::collections::HashSet<_> = valid_ids.into_iter().collect();
        let mut seen = std::collections::HashSet::new();
        Ok(ids
            .into_iter()
            .filter(|id| valid_ids.contains(id) && seen.insert(id.clone()))
            .take(MAX_RECENT_PRODUCT_APP_RUNTIME_HOSTS)
            .collect())
    }

    /// Record a Product App Runtime Host surface as recently opened and persist the newest-first list.
    pub async fn record_recent_opened(&self, app_id: &str) -> CoreResult<Vec<String>> {
        self.storage.load_meta(app_id).await?;
        let mut ids = self.list_recent_opened().await?;
        ids.retain(|id| id != app_id);
        ids.insert(0, app_id.to_string());
        ids.truncate(MAX_RECENT_PRODUCT_APP_RUNTIME_HOSTS);
        self.save_recent_opened_ids(&ids).await?;
        Ok(ids)
    }

    async fn remove_recent_opened(&self, app_id: &str) -> CoreResult<()> {
        let mut ids = self.list_recent_opened().await?;
        let original_len = ids.len();
        ids.retain(|id| id != app_id);
        if ids.len() != original_len {
            self.save_recent_opened_ids(&ids).await?;
        }
        Ok(())
    }

    /// Get full ProductAppRuntimeHostSurface by id.
    pub async fn get(&self, app_id: &str) -> CoreResult<ProductAppRuntimeHostSurface> {
        let mut app = self.storage.load(app_id).await?;
        if Self::ensure_runtime_state(&mut app) {
            self.storage.save(&app).await?;
        }
        Ok(app)
    }

    /// Create a new ProductAppRuntimeHostSurface (generates id, sets created_at/updated_at, compiles).
    #[allow(clippy::too_many_arguments)]
    pub async fn create(
        &self,
        name: String,
        description: String,
        icon: AppIconSpec,
        category: String,
        tags: Vec<String>,
        i18n: ProductAppRuntimeHostI18n,
        source: ProductAppRuntimeHostSource,
        permissions: ProductAppRuntimeHostPermissions,
        backends: Vec<ProductAppRuntimeHostBackendBinding>,
        interaction: Option<ProductAppRuntimeHostInteraction>,
        ai_context: Option<ProductAppRuntimeHostAiContext>,
        permission_rationale: Option<String>,
        workspace_root: Option<&Path>,
    ) -> CoreResult<ProductAppRuntimeHostSurface> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().timestamp_millis();

        let runtime = Self::build_runtime_state(
            1,
            now,
            &source,
            &permissions,
            !source.npm_dependencies.is_empty(),
            true,
        );
        let compiled_html =
            self.compile_source(&id, &source, &permissions, &runtime, "dark", workspace_root)?;

        let app = ProductAppRuntimeHostSurface {
            id: id.clone(),
            name,
            description,
            icon,
            category,
            tags,
            i18n,
            version: 1,
            created_at: now,
            updated_at: now,
            source,
            compiled_html,
            permissions,
            backends,
            interaction,
            ai_context,
            permission_rationale,
            runtime,
        };

        self.storage.save(&app).await?;
        Ok(app)
    }

    /// Update existing ProductAppRuntimeHostSurface (increment version, recompile, save).
    #[allow(clippy::too_many_arguments)]
    pub async fn update(
        &self,
        app_id: &str,
        name: Option<String>,
        description: Option<String>,
        icon: Option<AppIconSpec>,
        category: Option<String>,
        tags: Option<Vec<String>>,
        i18n: Option<ProductAppRuntimeHostI18n>,
        source: Option<ProductAppRuntimeHostSource>,
        permissions: Option<ProductAppRuntimeHostPermissions>,
        backends: Option<Vec<ProductAppRuntimeHostBackendBinding>>,
        interaction: Option<ProductAppRuntimeHostInteraction>,
        ai_context: Option<ProductAppRuntimeHostAiContext>,
        permission_rationale: Option<String>,
        workspace_root: Option<&Path>,
    ) -> CoreResult<ProductAppRuntimeHostSurface> {
        let mut app = self.storage.load(app_id).await?;
        let previous_app = app.clone();
        let source_changed = source.is_some();
        let permissions_changed = permissions.is_some();

        if let Some(n) = name {
            app.name = n;
        }
        if let Some(d) = description {
            app.description = d;
        }
        if let Some(i) = icon {
            app.icon = i;
        }
        if let Some(c) = category {
            app.category = c;
        }
        if let Some(t) = tags {
            app.tags = t;
        }
        if let Some(i18n) = i18n {
            app.i18n = i18n;
        }
        if let Some(s) = source {
            app.source = s;
        }
        if let Some(p) = permissions {
            app.permissions = p;
        }
        if let Some(backends) = backends {
            app.backends = backends;
        }
        if let Some(interaction) = interaction {
            app.interaction = Some(interaction);
        }
        if let Some(a) = ai_context {
            app.ai_context = Some(a);
        }
        if let Some(rationale) = permission_rationale {
            app.permission_rationale = Some(rationale);
        }
        if permissions_changed && permissions_include_workspace(&app.permissions) {
            let has_rationale = app
                .permission_rationale
                .as_deref()
                .map(str::trim)
                .is_some_and(|value| !value.is_empty());
            if !has_rationale {
                return Err(crate::error::CoreError::validation(
                    "Product App Runtime Host permissions include {workspace}; meta.permission_rationale is required"
                        .to_string(),
                ));
            }
        }

        app.version += 1;
        app.updated_at = Utc::now().timestamp_millis();

        let deps_changed = previous_app.source.npm_dependencies != app.source.npm_dependencies;
        if source_changed || permissions_changed {
            app.runtime.source_revision = Self::build_source_revision(app.version, app.updated_at);
            app.runtime.worker_restart_required = Self::node_runtime_enabled(&app.permissions);
        }
        if deps_changed {
            app.runtime.deps_revision = Self::build_deps_revision(&app.source);
            app.runtime.deps_dirty = Self::node_runtime_enabled(&app.permissions)
                && !app.source.npm_dependencies.is_empty();
            app.runtime.worker_restart_required = Self::node_runtime_enabled(&app.permissions);
        }
        if permissions_changed
            && Self::node_runtime_enabled(&app.permissions)
            && !app.source.npm_dependencies.is_empty()
        {
            app.runtime.deps_revision = Self::build_deps_revision(&app.source);
            app.runtime.deps_dirty = true;
        }
        app.runtime.ui_recompile_required = false;
        Self::ensure_runtime_state(&mut app);
        app.compiled_html = self.compile_source(
            app_id,
            &app.source,
            &app.permissions,
            &app.runtime,
            "dark",
            workspace_root,
        )?;

        self.storage
            .save_version(app_id, previous_app.version, &previous_app)
            .await?;
        self.storage.save(&app).await?;
        self.clear_runtime_issues(app_id).await;
        Ok(app)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn upsert_runtime_host(
        &self,
        app_id: &str,
        name: String,
        description: String,
        icon: AppIconSpec,
        category: String,
        tags: Vec<String>,
        source: ProductAppRuntimeHostSource,
        permissions: ProductAppRuntimeHostPermissions,
        backends: Vec<ProductAppRuntimeHostBackendBinding>,
        interaction: Option<ProductAppRuntimeHostInteraction>,
        workspace_root: Option<&Path>,
    ) -> CoreResult<ProductAppRuntimeHostSurface> {
        match self.storage.load(app_id).await {
            Ok(existing)
                if existing.name == name
                    && existing.description == description
                    && existing.icon == icon
                    && existing.category == category
                    && existing.tags == tags
                    && source_matches(&existing.source, &source)
                    && permissions_match(&existing.permissions, &permissions)
                    && backends_match(&existing.backends, &backends)
                    && interaction_matches(&existing.interaction, &interaction) =>
            {
                return Ok(existing);
            }
            Ok(mut existing) => {
                let previous = existing.clone();
                existing.name = name;
                existing.description = description;
                existing.icon = icon;
                existing.category = category;
                existing.tags = tags;
                existing.source = source;
                existing.permissions = permissions;
                existing.backends = backends;
                existing.interaction = interaction;
                existing.version += 1;
                existing.updated_at = Utc::now().timestamp_millis();
                existing.runtime = Self::build_runtime_state(
                    existing.version,
                    existing.updated_at,
                    &existing.source,
                    &existing.permissions,
                    !existing.source.npm_dependencies.is_empty(),
                    Self::node_runtime_enabled(&existing.permissions),
                );
                existing.compiled_html = self.compile_source(
                    app_id,
                    &existing.source,
                    &existing.permissions,
                    &existing.runtime,
                    "dark",
                    workspace_root,
                )?;
                self.storage
                    .save_version(app_id, previous.version, &previous)
                    .await?;
                self.storage.save(&existing).await?;
                self.clear_runtime_issues(app_id).await;
                Ok(existing)
            }
            Err(CoreError::NotFound(_)) => {
                let now = Utc::now().timestamp_millis();
                let runtime = Self::build_runtime_state(
                    1,
                    now,
                    &source,
                    &permissions,
                    !source.npm_dependencies.is_empty(),
                    Self::node_runtime_enabled(&permissions),
                );
                let compiled_html = self.compile_source(
                    app_id,
                    &source,
                    &permissions,
                    &runtime,
                    "dark",
                    workspace_root,
                )?;
                let app = ProductAppRuntimeHostSurface {
                    id: app_id.to_string(),
                    name,
                    description,
                    icon,
                    category,
                    tags,
                    i18n: ProductAppRuntimeHostI18n::default(),
                    version: 1,
                    created_at: now,
                    updated_at: now,
                    source,
                    compiled_html,
                    permissions,
                    backends,
                    interaction,
                    ai_context: None,
                    permission_rationale: None,
                    runtime,
                };
                self.storage.save(&app).await?;
                Ok(app)
            }
            Err(error) => Err(error),
        }
    }

    /// Delete ProductAppRuntimeHostSurface and its directory.
    pub async fn delete(&self, app_id: &str) -> CoreResult<()> {
        self.granted_paths.write().await.remove(app_id);
        self.remove_recent_opened(app_id).await?;
        self.storage.delete(app_id).await
    }

    /// Get the path manager (for external callers that need runtime host paths).
    pub fn path_manager(&self) -> &Arc<crate::infrastructure::PathManager> {
        &self.path_manager
    }

    /// Resolve permission policy for the given app (for JS Worker startup).
    pub async fn resolve_policy_for_app(
        &self,
        app_id: &str,
        permissions: &ProductAppRuntimeHostPermissions,
        workspace_root: Option<&Path>,
    ) -> serde_json::Value {
        let app_data_dir = self.path_manager.product_app_runtime_host_dir(app_id);
        let gp = self.granted_paths.read().await;
        let granted = gp.get(app_id).map(|v| v.as_slice()).unwrap_or(&[]);
        resolve_policy(permissions, app_id, &app_data_dir, workspace_root, granted)
    }

    /// Snapshot of user-granted extra paths for an app (used by the host-side dispatch
    /// to mirror what `resolve_policy_for_app` would inject into the worker policy).
    pub async fn granted_paths_for_app(&self, app_id: &str) -> Vec<PathBuf> {
        let gp = self.granted_paths.read().await;
        gp.get(app_id).cloned().unwrap_or_default()
    }

    /// Grant workspace access for an app (no-op; workspace context is supplied by caller).
    pub async fn grant_workspace(&self, _app_id: &str) {}

    /// Grant path (user-selected) for an app.
    pub async fn grant_path(&self, app_id: &str, path: PathBuf) {
        let mut guard = self.granted_paths.write().await;
        let list = guard.entry(app_id.to_string()).or_default();
        if !list.contains(&path) {
            list.push(path);
        }
    }

    /// Get app storage (KV) value.
    pub async fn get_storage(&self, app_id: &str, key: &str) -> CoreResult<serde_json::Value> {
        let storage = self.storage.load_app_storage(app_id).await?;
        Ok(storage.get(key).cloned().unwrap_or(serde_json::Value::Null))
    }

    pub async fn record_runtime_issue(&self, issue: ProductAppRuntimeHostRuntimeIssue) {
        let issue_key = runtime_diagnostics_key(&issue.app_id, issue.runtime_owner_id.as_deref());
        let mut issues = self.runtime_issues.write().await;
        let app_issues = issues.entry(issue_key).or_default();
        app_issues.push_back(issue.clone());
        while app_issues.len() > MAX_RUNTIME_ISSUES_PER_APP {
            app_issues.pop_front();
        }
        drop(issues);

        self.record_runtime_log(Self::log_from_issue(issue)).await;
    }

    pub async fn runtime_issues(
        &self,
        app_id: &str,
        since_ms: Option<i64>,
    ) -> Vec<ProductAppRuntimeHostRuntimeIssue> {
        self.runtime_issues_for_owner(app_id, None, since_ms).await
    }

    pub async fn runtime_issues_for_owner(
        &self,
        app_id: &str,
        runtime_owner_id: Option<&str>,
        since_ms: Option<i64>,
    ) -> Vec<ProductAppRuntimeHostRuntimeIssue> {
        let issue_key = runtime_diagnostics_key(app_id, runtime_owner_id);
        let issues = self.runtime_issues.read().await;
        issues
            .get(&issue_key)
            .map(|app_issues| {
                app_issues
                    .iter()
                    .filter(|issue| {
                        since_ms
                            .map(|since| issue.timestamp_ms >= since)
                            .unwrap_or(true)
                    })
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    pub async fn runtime_issues_for_work(
        &self,
        work_id: &str,
        since_ms: Option<i64>,
    ) -> Vec<ProductAppRuntimeHostRuntimeIssue> {
        let issues = self.runtime_issues.read().await;
        issues
            .values()
            .flat_map(|app_issues| app_issues.iter())
            .filter(|issue| issue.work_id.as_deref() == Some(work_id))
            .filter(|issue| {
                since_ms
                    .map(|since| issue.timestamp_ms >= since)
                    .unwrap_or(true)
            })
            .cloned()
            .collect()
    }

    pub async fn clear_runtime_issues(&self, app_id: &str) {
        self.runtime_issues.write().await.remove(app_id);
        self.runtime_logs.write().await.remove(app_id);
        self.record_runtime_log(ProductAppRuntimeHostRuntimeLog {
            app_id: app_id.to_string(),
            runtime_owner_id: None,
            work_id: None,
            runtime_instance_id: None,
            product_app_id: None,
            level: ProductAppRuntimeHostRuntimeLogLevel::Info,
            category: "lifecycle".to_string(),
            message: "Runtime diagnostics cleared".to_string(),
            source: None,
            stack: None,
            details: None,
            timestamp_ms: Utc::now().timestamp_millis(),
        })
        .await;
    }

    pub async fn record_runtime_log(&self, log_entry: ProductAppRuntimeHostRuntimeLog) {
        let log_entry = Self::sanitize_runtime_log(log_entry);
        let log_key =
            runtime_diagnostics_key(&log_entry.app_id, log_entry.runtime_owner_id.as_deref());
        let mut logs = self.runtime_logs.write().await;
        let app_logs = logs.entry(log_key).or_default();
        app_logs.push_back(log_entry.clone());
        while app_logs.len() > MAX_RUNTIME_LOGS_PER_APP {
            app_logs.pop_front();
        }
        drop(logs);

        self.append_runtime_log_to_disk(&log_entry).await;
        let _ = emit_global_event(BackendEvent::Custom {
            event_name: "product-app-runtime-log".to_string(),
            payload: json!(log_entry),
        })
        .await;
    }

    pub async fn runtime_logs(
        &self,
        app_id: &str,
        since_ms: Option<i64>,
        min_level: Option<ProductAppRuntimeHostRuntimeLogLevel>,
        tail: Option<usize>,
    ) -> Vec<ProductAppRuntimeHostRuntimeLog> {
        self.runtime_logs_for_owner(app_id, None, since_ms, min_level, tail)
            .await
    }

    pub async fn runtime_logs_for_owner(
        &self,
        app_id: &str,
        runtime_owner_id: Option<&str>,
        since_ms: Option<i64>,
        min_level: Option<ProductAppRuntimeHostRuntimeLogLevel>,
        tail: Option<usize>,
    ) -> Vec<ProductAppRuntimeHostRuntimeLog> {
        let log_key = runtime_diagnostics_key(app_id, runtime_owner_id);
        let logs = self.runtime_logs.read().await;
        let mut out: Vec<ProductAppRuntimeHostRuntimeLog> = logs
            .get(&log_key)
            .map(|app_logs| {
                app_logs
                    .iter()
                    .filter(|entry| {
                        since_ms
                            .map(|since| entry.timestamp_ms >= since)
                            .unwrap_or(true)
                    })
                    .filter(|entry| min_level.map(|level| entry.level >= level).unwrap_or(true))
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        if let Some(tail) = tail {
            if out.len() > tail {
                out = out.split_off(out.len() - tail);
            }
        }
        out
    }

    pub async fn runtime_logs_for_work(
        &self,
        work_id: &str,
        since_ms: Option<i64>,
        min_level: Option<ProductAppRuntimeHostRuntimeLogLevel>,
        tail: Option<usize>,
    ) -> Vec<ProductAppRuntimeHostRuntimeLog> {
        let logs = self.runtime_logs.read().await;
        let mut out: Vec<ProductAppRuntimeHostRuntimeLog> = logs
            .values()
            .flat_map(|app_logs| app_logs.iter())
            .filter(|entry| entry.work_id.as_deref() == Some(work_id))
            .filter(|entry| {
                since_ms
                    .map(|since| entry.timestamp_ms >= since)
                    .unwrap_or(true)
            })
            .filter(|entry| min_level.map(|level| entry.level >= level).unwrap_or(true))
            .cloned()
            .collect();
        out.sort_by(|left, right| left.timestamp_ms.cmp(&right.timestamp_ms));
        if let Some(tail) = tail {
            if out.len() > tail {
                out = out.split_off(out.len() - tail);
            }
        }
        out
    }

    fn log_from_issue(issue: ProductAppRuntimeHostRuntimeIssue) -> ProductAppRuntimeHostRuntimeLog {
        ProductAppRuntimeHostRuntimeLog {
            app_id: issue.app_id,
            runtime_owner_id: issue.runtime_owner_id,
            work_id: issue.work_id,
            runtime_instance_id: issue.runtime_instance_id,
            product_app_id: issue.product_app_id,
            level: match issue.severity {
                ProductAppRuntimeHostRuntimeIssueSeverity::Fatal => {
                    ProductAppRuntimeHostRuntimeLogLevel::Error
                }
                ProductAppRuntimeHostRuntimeIssueSeverity::Warning => {
                    ProductAppRuntimeHostRuntimeLogLevel::Warn
                }
                ProductAppRuntimeHostRuntimeIssueSeverity::Noise => {
                    ProductAppRuntimeHostRuntimeLogLevel::Debug
                }
            },
            category: issue.category.unwrap_or_else(|| "runtime".to_string()),
            message: issue.message,
            source: issue.source,
            stack: issue.stack,
            details: None,
            timestamp_ms: issue.timestamp_ms,
        }
    }

    fn sanitize_runtime_log(
        mut entry: ProductAppRuntimeHostRuntimeLog,
    ) -> ProductAppRuntimeHostRuntimeLog {
        entry.message = truncate_chars(&entry.message, MAX_RUNTIME_MESSAGE_CHARS);
        entry.stack = entry
            .stack
            .map(|stack| truncate_chars(&stack, MAX_RUNTIME_STACK_CHARS));
        entry.details = entry.details.map(|details| {
            let serialized = serde_json::to_string(&details).unwrap_or_else(|_| "null".to_string());
            if serialized.len() <= MAX_RUNTIME_DETAILS_CHARS {
                details
            } else {
                json!({
                    "truncated": true,
                    "preview": truncate_chars(&serialized, MAX_RUNTIME_DETAILS_CHARS)
                })
            }
        });
        entry
    }

    async fn append_runtime_log_to_disk(&self, entry: &ProductAppRuntimeHostRuntimeLog) {
        let log_dir = self
            .path_manager
            .product_app_runtime_host_dir(&entry.app_id)
            .join("_logs");
        if let Err(e) = tokio::fs::create_dir_all(&log_dir).await {
            log::warn!("Failed to create Product App Runtime host log dir: {}", e);
            return;
        }

        let log_path = log_dir.join("runtime.ndjson");
        if let Ok(metadata) = tokio::fs::metadata(&log_path).await {
            if metadata.len() > MAX_RUNTIME_LOG_FILE_BYTES {
                let rotated = log_dir.join("runtime.1.ndjson");
                let _ = tokio::fs::remove_file(&rotated).await;
                let _ = tokio::fs::rename(&log_path, rotated).await;
            }
        }

        let line = match serde_json::to_string(entry) {
            Ok(line) => line,
            Err(e) => {
                log::warn!("Failed to serialize Product App Runtime host log: {}", e);
                return;
            }
        };
        let mut file = match tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .await
        {
            Ok(file) => file,
            Err(e) => {
                log::warn!("Failed to open Product App Runtime host log file: {}", e);
                return;
            }
        };
        if let Err(e) = file.write_all(format!("{line}\n").as_bytes()).await {
            log::warn!("Failed to append Product App Runtime host log: {}", e);
        }
    }

    /// Set app storage (KV) value.
    pub async fn set_storage(
        &self,
        app_id: &str,
        key: &str,
        value: serde_json::Value,
    ) -> CoreResult<()> {
        self.storage.save_app_storage(app_id, key, value).await
    }

    pub async fn mark_deps_installed(
        &self,
        app_id: &str,
    ) -> CoreResult<ProductAppRuntimeHostSurface> {
        let mut app = self.storage.load(app_id).await?;
        Self::ensure_runtime_state(&mut app);
        app.runtime.deps_dirty = false;
        app.runtime.worker_restart_required = true;
        self.storage.save(&app).await?;
        Ok(app)
    }

    pub async fn clear_worker_restart_required(
        &self,
        app_id: &str,
    ) -> CoreResult<ProductAppRuntimeHostSurface> {
        let mut app = self.storage.load(app_id).await?;
        Self::ensure_runtime_state(&mut app);
        if app.runtime.worker_restart_required {
            app.runtime.worker_restart_required = false;
            self.storage.save(&app).await?;
        }
        Ok(app)
    }

    /// List version numbers for an app.
    pub async fn list_versions(&self, app_id: &str) -> CoreResult<Vec<u32>> {
        self.storage.list_versions(app_id).await
    }

    /// Rollback app to a previous version (loads version snapshot, saves as current).
    pub async fn rollback(
        &self,
        app_id: &str,
        version: u32,
    ) -> CoreResult<ProductAppRuntimeHostSurface> {
        let current = self.storage.load(app_id).await?;
        let mut app = self.storage.load_version(app_id, version).await?;
        let now = Utc::now().timestamp_millis();
        app.version = current.version + 1;
        app.updated_at = now;
        app.runtime = Self::build_runtime_state(
            app.version,
            app.updated_at,
            &app.source,
            &app.permissions,
            !app.source.npm_dependencies.is_empty(),
            true,
        );
        self.storage
            .save_version(app_id, current.version, &current)
            .await?;
        self.storage.save(&app).await?;
        self.clear_runtime_issues(app_id).await;
        Ok(app)
    }

    /// Recompile app (e.g. after workspace or theme change). Updates compiled_html and saves.
    pub async fn recompile(
        &self,
        app_id: &str,
        theme: &str,
        workspace_root: Option<&Path>,
    ) -> CoreResult<ProductAppRuntimeHostSurface> {
        let mut app = self.storage.load(app_id).await?;
        Self::ensure_runtime_state(&mut app);
        app.compiled_html = self.compile_source(
            app_id,
            &app.source,
            &app.permissions,
            &app.runtime,
            theme,
            workspace_root,
        )?;
        app.updated_at = Utc::now().timestamp_millis();
        app.runtime.ui_recompile_required = false;
        self.storage.save(&app).await?;
        self.clear_runtime_issues(app_id).await;
        Ok(app)
    }

    pub async fn sync_from_fs(
        &self,
        app_id: &str,
        theme: &str,
        workspace_root: Option<&Path>,
    ) -> CoreResult<ProductAppRuntimeHostSurface> {
        let previous_app = self.storage.load(app_id).await?;
        let mut app = previous_app.clone();
        let meta = self.storage.load_meta(app_id).await?;
        app.name = meta.name;
        app.description = meta.description;
        app.icon = meta.icon;
        app.category = meta.category;
        app.tags = meta.tags;
        app.i18n = meta.i18n;
        app.permissions = meta.permissions;
        app.ai_context = meta.ai_context;
        app.permission_rationale = meta.permission_rationale;
        if permissions_include_workspace(&app.permissions) {
            let has_rationale = app
                .permission_rationale
                .as_deref()
                .map(str::trim)
                .is_some_and(|value| !value.is_empty());
            if !has_rationale {
                return Err(CoreError::validation(
                    "Product App Runtime Host permissions include {workspace}; meta.permission_rationale is required"
                        .to_string(),
                ));
            }
        }
        app.source = self.storage.load_source_only(app_id).await?;
        app.version += 1;
        app.updated_at = Utc::now().timestamp_millis();

        app.runtime = Self::build_runtime_state(
            app.version,
            app.updated_at,
            &app.source,
            &app.permissions,
            !app.source.npm_dependencies.is_empty(),
            true,
        );
        app.compiled_html = self.compile_source(
            app_id,
            &app.source,
            &app.permissions,
            &app.runtime,
            theme,
            workspace_root,
        )?;
        self.storage
            .save_version(app_id, previous_app.version, &previous_app)
            .await?;
        self.storage.save(&app).await?;
        self.clear_runtime_issues(app_id).await;
        Ok(app)
    }

    /// Import a Product App Runtime Host surface from a directory. Copies meta, source,
    /// package.json, storage into a new host surface id and recompiles.
    pub async fn import_from_path(
        &self,
        source_path: PathBuf,
        workspace_root: Option<&Path>,
    ) -> CoreResult<ProductAppRuntimeHostSurface> {
        use crate::error::CoreError;

        let src = source_path.as_path();
        if !src.is_dir() {
            return Err(CoreError::validation(format!(
                "Not a directory: {}",
                src.display()
            )));
        }

        let meta_path = src.join("meta.json");
        let source_dir = src.join("source");
        if !meta_path.exists() {
            return Err(CoreError::validation(format!(
                "Missing meta.json in {}",
                src.display()
            )));
        }
        if !source_dir.is_dir() {
            return Err(CoreError::validation(format!(
                "Missing source/ directory in {}",
                src.display()
            )));
        }
        for required in &["index.html", "worker.js"] {
            if !source_dir.join(required).exists() {
                return Err(CoreError::validation(format!(
                    "Missing source/{} in {}",
                    required,
                    src.display()
                )));
            }
        }

        let meta_content = tokio::fs::read_to_string(&meta_path)
            .await
            .map_err(|e| CoreError::io(format!("Failed to read meta.json: {}", e)))?;
        let mut meta: ProductAppRuntimeHostSurfaceMeta = serde_json::from_str(&meta_content)
            .map_err(|e| CoreError::parse(format!("Invalid meta.json: {}", e)))?;

        let id = Uuid::new_v4().to_string();
        let now = Utc::now().timestamp_millis();
        meta.id = id.clone();
        meta.created_at = now;
        meta.updated_at = now;

        let dest_dir = self.path_manager.product_app_runtime_host_dir(&id);
        let dest_source = dest_dir.join("source");
        tokio::fs::create_dir_all(&dest_source)
            .await
            .map_err(|e| CoreError::io(format!("Failed to create app dir: {}", e)))?;

        let meta_json = serde_json::to_string_pretty(&meta).map_err(CoreError::from)?;
        tokio::fs::write(dest_dir.join("meta.json"), meta_json)
            .await
            .map_err(|e| CoreError::io(format!("Failed to write meta.json: {}", e)))?;

        ProductAppRuntimeHostStorage::copy_source_dir_recursive(&source_dir, &dest_source).await?;
        let esm_path = source_dir.join("esm_dependencies.json");
        if esm_path.exists() {
            tokio::fs::copy(&esm_path, dest_source.join("esm_dependencies.json"))
                .await
                .map_err(|e| {
                    CoreError::io(format!("Failed to copy esm_dependencies.json: {}", e))
                })?;
        } else {
            tokio::fs::write(dest_source.join("esm_dependencies.json"), "[]")
                .await
                .map_err(|_e| CoreError::io("Failed to write esm_dependencies.json"))?;
        }
        let i18n_path = source_dir.join("i18n.json");
        if i18n_path.exists() {
            tokio::fs::copy(&i18n_path, dest_source.join("i18n.json"))
                .await
                .map_err(|e| CoreError::io(format!("Failed to copy i18n.json: {}", e)))?;
        } else {
            tokio::fs::write(dest_source.join("i18n.json"), "{}")
                .await
                .map_err(|_e| CoreError::io("Failed to write i18n.json"))?;
        }

        let pkg_src = src.join("package.json");
        if pkg_src.exists() {
            tokio::fs::copy(&pkg_src, dest_dir.join("package.json"))
                .await
                .map_err(|e| CoreError::io(format!("Failed to copy package.json: {}", e)))?;
        } else {
            let pkg = serde_json::json!({
                "name": format!("product-app-{}", id),
                "private": true,
                "dependencies": {}
            });
            tokio::fs::write(
                dest_dir.join("package.json"),
                serde_json::to_string_pretty(&pkg).map_err(CoreError::from)?,
            )
            .await
            .map_err(|_e| CoreError::io("Failed to write package.json"))?;
        }

        let storage_src = src.join("storage.json");
        if storage_src.exists() {
            tokio::fs::copy(&storage_src, dest_dir.join("storage.json"))
                .await
                .map_err(|e| CoreError::io(format!("Failed to copy storage.json: {}", e)))?;
        } else {
            tokio::fs::write(dest_dir.join("storage.json"), "{}")
                .await
                .map_err(|_e| CoreError::io("Failed to write storage.json"))?;
        }

        let placeholder_html = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body>Loading...</body></html>";
        tokio::fs::write(dest_dir.join("compiled.html"), placeholder_html)
            .await
            .map_err(|_e| CoreError::io("Failed to write placeholder compiled.html"))?;

        let mut app = self.recompile(&id, "dark", workspace_root).await?;
        app.runtime = Self::build_runtime_state(
            app.version,
            app.updated_at,
            &app.source,
            &app.permissions,
            !app.source.npm_dependencies.is_empty(),
            true,
        );
        self.storage.save(&app).await?;
        Ok(app)
    }
}
