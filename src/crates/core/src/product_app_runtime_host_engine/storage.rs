//! Product App Runtime Host storage: persist and load under user data dir.

use crate::error::{CoreError, CoreResult};
use crate::product_app_runtime_host_engine::types::{
    NpmDep, ProductAppRuntimeHostEntry, ProductAppRuntimeHostSource,
    ProductAppRuntimeHostSourceFile, ProductAppRuntimeHostSourceFileKind,
    ProductAppRuntimeHostSurface, ProductAppRuntimeHostSurfaceMeta,
};
use serde_json;
use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

const META_JSON: &str = "meta.json";
const SOURCE_DIR: &str = "source";
const INDEX_HTML: &str = "index.html";
const STYLE_CSS: &str = "style.css";
const UI_JS: &str = "ui.js";
const WORKER_JS: &str = "worker.js";
const PACKAGE_JSON: &str = "package.json";
const ESM_DEPS_JSON: &str = "esm_dependencies.json";
const I18N_JSON: &str = "i18n.json";
const SOURCE_MANIFEST_JSON: &str = "source_manifest.json";
const COMPILED_HTML: &str = "compiled.html";
const STORAGE_JSON: &str = "storage.json";
const VERSIONS_DIR: &str = "versions";
const STANDARD_SOURCE_FILES: &[&str] = &[
    INDEX_HTML,
    STYLE_CSS,
    UI_JS,
    WORKER_JS,
    ESM_DEPS_JSON,
    I18N_JSON,
    SOURCE_MANIFEST_JSON,
];
static SOURCE_SNAPSHOT_SEQUENCE: AtomicU64 = AtomicU64::new(1);

fn infer_source_file_kind(path: &str) -> ProductAppRuntimeHostSourceFileKind {
    if path.ends_with(".js") || path.ends_with(".mjs") || path.ends_with(".ts") {
        ProductAppRuntimeHostSourceFileKind::Script
    } else if path.ends_with(".css") || path.ends_with(".scss") {
        ProductAppRuntimeHostSourceFileKind::Style
    } else if path.ends_with(".html") {
        ProductAppRuntimeHostSourceFileKind::Html
    } else if path.ends_with(".json") {
        ProductAppRuntimeHostSourceFileKind::Json
    } else {
        ProductAppRuntimeHostSourceFileKind::Asset
    }
}

fn sanitize_source_relative_path(path: &str) -> CoreResult<PathBuf> {
    let normalized = path.replace('\\', "/");
    let segments = normalized.split('/').collect::<Vec<_>>();
    let invalid_segment = segments.iter().any(|segment| {
        segment.is_empty()
            || *segment == "."
            || *segment == ".."
            || segment.contains(':')
            || segment.eq_ignore_ascii_case("node_modules")
    });
    let candidate = Path::new(&normalized);
    let invalid_component = candidate
        .components()
        .any(|component| !matches!(component, Component::Normal(_)));
    if normalized.is_empty()
        || normalized.contains('\0')
        || invalid_segment
        || invalid_component
        || STANDARD_SOURCE_FILES
            .iter()
            .any(|standard| normalized.eq_ignore_ascii_case(standard))
    {
        return Err(CoreError::validation(format!(
            "Invalid source file path: {}",
            path
        )));
    }
    let mut relative = PathBuf::new();
    for segment in segments {
        relative.push(segment);
    }
    Ok(relative)
}

/// Product App Runtime Host storage service (file-based under `path_manager.product_app_runtime_hosts_dir()`).
pub struct ProductAppRuntimeHostStorage {
    path_manager: Arc<crate::infrastructure::PathManager>,
    snapshot_lock: RwLock<()>,
}

impl ProductAppRuntimeHostStorage {
    pub fn new(path_manager: Arc<crate::infrastructure::PathManager>) -> Self {
        Self {
            path_manager,
            snapshot_lock: RwLock::new(()),
        }
    }

    fn app_dir(&self, app_id: &str) -> PathBuf {
        self.path_manager.product_app_runtime_host_dir(app_id)
    }

    fn meta_path(&self, app_id: &str) -> PathBuf {
        self.app_dir(app_id).join(META_JSON)
    }

    fn source_dir(&self, app_id: &str) -> PathBuf {
        self.app_dir(app_id).join(SOURCE_DIR)
    }

    fn compiled_path(&self, app_id: &str) -> PathBuf {
        self.app_dir(app_id).join(COMPILED_HTML)
    }

    fn storage_path(&self, app_id: &str) -> PathBuf {
        self.app_dir(app_id).join(STORAGE_JSON)
    }

    fn version_path(&self, app_id: &str, version: u32) -> PathBuf {
        self.app_dir(app_id)
            .join(VERSIONS_DIR)
            .join(format!("v{}.json", version))
    }

    /// Ensure app directory and source subdir exist.
    pub async fn ensure_app_dir(&self, app_id: &str) -> CoreResult<()> {
        let _guard = self.snapshot_lock.write().await;
        self.ensure_app_dir_unlocked(app_id).await
    }

    async fn ensure_app_dir_unlocked(&self, app_id: &str) -> CoreResult<()> {
        let dir = self.app_dir(app_id);
        let source = self.source_dir(app_id);
        tokio::fs::create_dir_all(&dir).await.map_err(|e| {
            CoreError::io(format!(
                "Failed to create Product App dir {}: {}",
                dir.display(),
                e
            ))
        })?;
        tokio::fs::create_dir_all(&source).await.map_err(|e| {
            CoreError::io(format!(
                "Failed to create source dir {}: {}",
                source.display(),
                e
            ))
        })?;
        Ok(())
    }

    /// List all app IDs (directories under `product_app_runtime_hosts_dir`).
    pub async fn list_app_ids(&self) -> CoreResult<Vec<String>> {
        let root = self.path_manager.product_app_runtime_hosts_dir();
        if !root.exists() {
            return Ok(Vec::new());
        }
        let mut ids = Vec::new();
        let mut read_dir = tokio::fs::read_dir(&root).await.map_err(|e| {
            CoreError::io(format!(
                "Failed to read Product App Runtime hosts dir: {}",
                e
            ))
        })?;
        while let Some(entry) = read_dir.next_entry().await.map_err(|e| {
            CoreError::io(format!(
                "Failed to read Product App Runtime hosts entry: {}",
                e
            ))
        })? {
            let path = entry.path();
            if path.is_dir() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if !name.starts_with('.') {
                        ids.push(name.to_string());
                    }
                }
            }
        }
        Ok(ids)
    }

    /// Load full Product App Runtime Host surface by id (meta + source + compiled_html).
    pub async fn load(&self, app_id: &str) -> CoreResult<ProductAppRuntimeHostSurface> {
        let _guard = self.snapshot_lock.read().await;
        let meta_path = self.meta_path(app_id);
        let meta_content = tokio::fs::read_to_string(&meta_path).await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                CoreError::NotFound(format!(
                    "Product App Runtime Host surface not found: {}",
                    app_id
                ))
            } else {
                CoreError::io(format!("Failed to read meta: {}", e))
            }
        })?;
        let meta: ProductAppRuntimeHostSurfaceMeta = serde_json::from_str(&meta_content)
            .map_err(|e| CoreError::parse(format!("Invalid meta.json: {}", e)))?;

        let source = self.load_source(app_id).await?;
        let compiled_html = self.load_compiled_html(app_id).await?;

        Ok(ProductAppRuntimeHostSurface {
            id: meta.id,
            name: meta.name,
            description: meta.description,
            icon: meta.icon,
            category: meta.category,
            tags: meta.tags,
            i18n: meta.i18n,
            version: meta.version,
            created_at: meta.created_at,
            updated_at: meta.updated_at,
            source,
            compiled_html,
            permissions: meta.permissions,
            backends: meta.backends,
            interaction: meta.interaction,
            ai_context: meta.ai_context,
            permission_rationale: meta.permission_rationale,
            runtime: meta.runtime,
        })
    }

    /// Load only metadata (for list views).
    pub async fn load_meta(&self, app_id: &str) -> CoreResult<ProductAppRuntimeHostSurfaceMeta> {
        let meta_path = self.meta_path(app_id);
        let content = tokio::fs::read_to_string(&meta_path).await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                CoreError::NotFound(format!(
                    "Product App Runtime Host surface not found: {}",
                    app_id
                ))
            } else {
                CoreError::io(format!("Failed to read meta: {}", e))
            }
        })?;
        serde_json::from_str(&content)
            .map_err(|e| CoreError::parse(format!("Invalid meta.json: {}", e)))
    }

    async fn load_source(&self, app_id: &str) -> CoreResult<ProductAppRuntimeHostSource> {
        let sd = self.source_dir(app_id);
        let html = tokio::fs::read_to_string(sd.join(INDEX_HTML))
            .await
            .unwrap_or_default();
        let css = tokio::fs::read_to_string(sd.join(STYLE_CSS))
            .await
            .unwrap_or_default();
        let ui_js = tokio::fs::read_to_string(sd.join(UI_JS))
            .await
            .unwrap_or_default();
        let worker_js = tokio::fs::read_to_string(sd.join(WORKER_JS))
            .await
            .unwrap_or_default();

        let esm_dependencies = if sd.join(ESM_DEPS_JSON).exists() {
            let c = tokio::fs::read_to_string(sd.join(ESM_DEPS_JSON))
                .await
                .unwrap_or_default();
            serde_json::from_str(&c).unwrap_or_default()
        } else {
            Vec::new()
        };
        let i18n_messages = if sd.join(I18N_JSON).exists() {
            let c = tokio::fs::read_to_string(sd.join(I18N_JSON))
                .await
                .unwrap_or_default();
            serde_json::from_str(&c).unwrap_or_else(|_| serde_json::json!({}))
        } else {
            serde_json::json!({})
        };

        let npm_dependencies = self.load_npm_dependencies(app_id).await?;
        let source_files = self.load_extra_source_files(app_id).await?;
        let entry = self.load_source_entry(app_id).await?;

        Ok(ProductAppRuntimeHostSource {
            html,
            css,
            ui_js,
            esm_dependencies,
            i18n_messages,
            worker_js,
            npm_dependencies,
            entry,
            source_files,
        })
    }

    async fn load_source_entry(&self, app_id: &str) -> CoreResult<ProductAppRuntimeHostEntry> {
        let path = self.source_dir(app_id).join(SOURCE_MANIFEST_JSON);
        if !path.exists() {
            return Ok(ProductAppRuntimeHostEntry::default());
        }
        let content = tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| CoreError::io(format!("Failed to read source_manifest.json: {}", e)))?;
        serde_json::from_str(&content)
            .map_err(|e| CoreError::parse(format!("Invalid source_manifest.json: {}", e)))
    }

    async fn load_extra_source_files(
        &self,
        app_id: &str,
    ) -> CoreResult<Vec<ProductAppRuntimeHostSourceFile>> {
        let sd = self.source_dir(app_id);
        let mut files = Vec::new();
        if !sd.exists() {
            return Ok(files);
        }
        let mut stack = vec![sd.clone()];
        while let Some(dir) = stack.pop() {
            let mut read_dir = tokio::fs::read_dir(&dir)
                .await
                .map_err(|e| CoreError::io(format!("Failed to read source dir: {}", e)))?;
            while let Some(entry) = read_dir
                .next_entry()
                .await
                .map_err(|e| CoreError::io(format!("Failed to read source entry: {}", e)))?
            {
                let path = entry.path();
                if path.is_dir() {
                    if path.file_name().is_some_and(|name| name == "node_modules") {
                        continue;
                    }
                    stack.push(path);
                    continue;
                }
                let relative = path
                    .strip_prefix(&sd)
                    .map_err(|e| CoreError::io(format!("Invalid source path: {}", e)))?
                    .to_string_lossy()
                    .replace('\\', "/");
                if STANDARD_SOURCE_FILES.contains(&relative.as_str()) {
                    continue;
                }
                let content = tokio::fs::read_to_string(&path).await.unwrap_or_default();
                files.push(ProductAppRuntimeHostSourceFile {
                    kind: infer_source_file_kind(&relative),
                    path: relative,
                    content,
                });
            }
        }
        files.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(files)
    }

    /// Load only source files and package dependencies from disk.
    pub async fn load_source_only(&self, app_id: &str) -> CoreResult<ProductAppRuntimeHostSource> {
        let _guard = self.snapshot_lock.read().await;
        self.load_source(app_id).await
    }

    async fn load_npm_dependencies(&self, app_id: &str) -> CoreResult<Vec<NpmDep>> {
        let p = self.app_dir(app_id).join(PACKAGE_JSON);
        if !p.exists() {
            return Ok(Vec::new());
        }
        let c = tokio::fs::read_to_string(&p)
            .await
            .map_err(|e| CoreError::io(format!("Failed to read package.json: {}", e)))?;
        let pkg: serde_json::Value = serde_json::from_str(&c)
            .map_err(|e| CoreError::parse(format!("Invalid package.json: {}", e)))?;
        let empty = serde_json::Map::new();
        let deps = pkg
            .get("dependencies")
            .and_then(|d| d.as_object())
            .unwrap_or(&empty);
        let npm_dependencies: Vec<NpmDep> = deps
            .iter()
            .map(|(name, v)| NpmDep {
                name: name.clone(),
                version: v.as_str().unwrap_or("*").to_string(),
            })
            .collect();
        Ok(npm_dependencies)
    }

    async fn load_compiled_html(&self, app_id: &str) -> CoreResult<String> {
        let p = self.compiled_path(app_id);
        tokio::fs::read_to_string(&p).await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                CoreError::NotFound(format!("Compiled HTML not found: {}", app_id))
            } else {
                CoreError::io(format!("Failed to read compiled.html: {}", e))
            }
        })
    }

    /// Save full Product App Runtime Host surface (meta, source files, compiled.html).
    pub async fn save(&self, app: &ProductAppRuntimeHostSurface) -> CoreResult<()> {
        let _guard = self.snapshot_lock.write().await;
        self.ensure_app_dir_unlocked(&app.id).await?;

        self.replace_source_snapshot(&app.id, &app.source).await?;

        let meta = ProductAppRuntimeHostSurfaceMeta::from(app);
        let meta_path = self.meta_path(&app.id);
        let meta_json = serde_json::to_string_pretty(&meta).map_err(CoreError::from)?;
        tokio::fs::write(&meta_path, meta_json)
            .await
            .map_err(|e| CoreError::io(format!("Failed to write meta: {}", e)))?;

        self.write_package_json(&app.id, &app.source.npm_dependencies)
            .await?;

        tokio::fs::write(self.compiled_path(&app.id), &app.compiled_html)
            .await
            .map_err(|e| CoreError::io(format!("Failed to write compiled.html: {}", e)))?;

        Ok(())
    }

    async fn replace_source_snapshot(
        &self,
        app_id: &str,
        source: &ProductAppRuntimeHostSource,
    ) -> CoreResult<()> {
        let mut source_files = Vec::with_capacity(source.source_files.len());
        let mut seen_paths = BTreeSet::new();
        for file in &source.source_files {
            let relative = sanitize_source_relative_path(&file.path)?;
            let normalized = relative.to_string_lossy().replace('\\', "/");
            if !seen_paths.insert(normalized.to_ascii_lowercase()) {
                return Err(CoreError::validation(format!(
                    "Duplicate source file path: {}",
                    file.path
                )));
            }
            source_files.push((relative, file));
        }

        let source_manifest =
            serde_json::to_string_pretty(&source.entry).map_err(CoreError::from)?;
        let esm_json =
            serde_json::to_string_pretty(&source.esm_dependencies).map_err(CoreError::from)?;
        let i18n_json =
            serde_json::to_string_pretty(&source.i18n_messages).map_err(CoreError::from)?;

        let sequence = SOURCE_SNAPSHOT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let app_dir = self.app_dir(app_id);
        let source_dir = self.source_dir(app_id);
        let staging_dir = app_dir.join(format!(
            ".{SOURCE_DIR}.staging-{}-{sequence}",
            std::process::id()
        ));
        let backup_dir = app_dir.join(format!(
            ".{SOURCE_DIR}.backup-{}-{sequence}",
            std::process::id()
        ));

        for transaction_dir in [&staging_dir, &backup_dir] {
            if transaction_dir.exists() {
                tokio::fs::remove_dir_all(transaction_dir)
                    .await
                    .map_err(|e| {
                        CoreError::io(format!(
                            "Failed to reset source transaction dir {}: {}",
                            transaction_dir.display(),
                            e
                        ))
                    })?;
            }
        }
        tokio::fs::create_dir_all(&staging_dir)
            .await
            .map_err(|e| CoreError::io(format!("Failed to create source staging dir: {}", e)))?;

        let prepare_result = async {
            Self::write_source_file(&staging_dir, INDEX_HTML, &source.html).await?;
            Self::write_source_file(&staging_dir, STYLE_CSS, &source.css).await?;
            Self::write_source_file(&staging_dir, UI_JS, &source.ui_js).await?;
            Self::write_source_file(&staging_dir, WORKER_JS, &source.worker_js).await?;
            Self::write_source_file(&staging_dir, SOURCE_MANIFEST_JSON, &source_manifest).await?;
            Self::write_source_file(&staging_dir, ESM_DEPS_JSON, &esm_json).await?;
            Self::write_source_file(&staging_dir, I18N_JSON, &i18n_json).await?;
            for (relative, file) in source_files {
                let path = staging_dir.join(relative);
                if let Some(parent) = path.parent() {
                    tokio::fs::create_dir_all(parent).await.map_err(|e| {
                        CoreError::io(format!("Failed to create source file dir: {}", e))
                    })?;
                }
                tokio::fs::write(&path, &file.content).await.map_err(|e| {
                    CoreError::io(format!("Failed to write source file {}: {}", file.path, e))
                })?;
            }
            Ok::<(), CoreError>(())
        }
        .await;
        if let Err(error) = prepare_result {
            let _ = tokio::fs::remove_dir_all(&staging_dir).await;
            return Err(error);
        }

        let had_source = source_dir.exists();
        if had_source {
            if let Err(error) = tokio::fs::rename(&source_dir, &backup_dir).await {
                let _ = tokio::fs::remove_dir_all(&staging_dir).await;
                return Err(CoreError::io(format!(
                    "Failed to preserve source snapshot {}: {}",
                    source_dir.display(),
                    error
                )));
            }
        }

        if let Err(install_error) = tokio::fs::rename(&staging_dir, &source_dir).await {
            let rollback_error = if had_source {
                tokio::fs::rename(&backup_dir, &source_dir).await.err()
            } else {
                None
            };
            let _ = tokio::fs::remove_dir_all(&staging_dir).await;
            return Err(CoreError::io(match rollback_error {
                Some(rollback_error) => format!(
                    "Failed to commit source snapshot {}: {}; rollback also failed: {}",
                    source_dir.display(),
                    install_error,
                    rollback_error
                ),
                None => format!(
                    "Failed to commit source snapshot {}: {}",
                    source_dir.display(),
                    install_error
                ),
            }));
        }

        if had_source {
            if let Err(error) = tokio::fs::remove_dir_all(&backup_dir).await {
                log::warn!(
                    "Source snapshot was replaced but backup cleanup failed: app_id={}, backup_dir={}, error={}",
                    app_id,
                    backup_dir.display(),
                    error
                );
            }
        }
        Ok(())
    }

    async fn write_source_file(root: &Path, relative: &str, content: &str) -> CoreResult<()> {
        tokio::fs::write(root.join(relative), content)
            .await
            .map_err(|e| CoreError::io(format!("Failed to write {}: {}", relative, e)))
    }

    pub async fn copy_source_dir_recursive(
        from: &std::path::Path,
        to: &std::path::Path,
    ) -> CoreResult<()> {
        tokio::fs::create_dir_all(to)
            .await
            .map_err(|e| CoreError::io(format!("Failed to create source dir: {}", e)))?;
        let mut stack = vec![from.to_path_buf()];
        while let Some(dir) = stack.pop() {
            let mut read_dir = tokio::fs::read_dir(&dir)
                .await
                .map_err(|e| CoreError::io(format!("Failed to read source dir: {}", e)))?;
            while let Some(entry) = read_dir
                .next_entry()
                .await
                .map_err(|e| CoreError::io(format!("Failed to read source entry: {}", e)))?
            {
                let path = entry.path();
                let relative = path
                    .strip_prefix(from)
                    .map_err(|e| CoreError::io(format!("Invalid source path: {}", e)))?;
                let dest = to.join(relative);
                if path.is_dir() {
                    tokio::fs::create_dir_all(&dest).await.map_err(|e| {
                        CoreError::io(format!("Failed to create source subdir: {}", e))
                    })?;
                    stack.push(path);
                } else {
                    if let Some(parent) = dest.parent() {
                        tokio::fs::create_dir_all(parent).await.map_err(|e| {
                            CoreError::io(format!("Failed to create source file dir: {}", e))
                        })?;
                    }
                    tokio::fs::copy(&path, &dest)
                        .await
                        .map_err(|e| CoreError::io(format!("Failed to copy source file: {}", e)))?;
                }
            }
        }
        Ok(())
    }

    async fn write_package_json(&self, app_id: &str, deps: &[NpmDep]) -> CoreResult<()> {
        let mut dependencies = serde_json::Map::new();
        for d in deps {
            dependencies.insert(d.name.clone(), serde_json::Value::String(d.version.clone()));
        }
        let pkg = serde_json::json!({
            "name": format!("product-app-{}", app_id),
            "private": true,
            "dependencies": dependencies
        });
        let p = self.app_dir(app_id).join(PACKAGE_JSON);
        let json = serde_json::to_string_pretty(&pkg).map_err(CoreError::from)?;
        tokio::fs::write(&p, json)
            .await
            .map_err(|e| CoreError::io(format!("Failed to write package.json: {}", e)))?;
        Ok(())
    }

    /// Save a version snapshot (for rollback).
    pub async fn save_version(
        &self,
        app_id: &str,
        version: u32,
        app: &ProductAppRuntimeHostSurface,
    ) -> CoreResult<()> {
        let versions_dir = self.app_dir(app_id).join(VERSIONS_DIR);
        tokio::fs::create_dir_all(&versions_dir)
            .await
            .map_err(|e| CoreError::io(format!("Failed to create versions dir: {}", e)))?;
        let path = self.version_path(app_id, version);
        let json = serde_json::to_string_pretty(app).map_err(CoreError::from)?;
        tokio::fs::write(&path, json)
            .await
            .map_err(|e| CoreError::io(format!("Failed to write version file: {}", e)))?;
        Ok(())
    }

    /// Load app storage (KV JSON). Returns empty object if missing.
    pub async fn load_app_storage(&self, app_id: &str) -> CoreResult<serde_json::Value> {
        let p = self.storage_path(app_id);
        if !p.exists() {
            return Ok(serde_json::json!({}));
        }
        let c = tokio::fs::read_to_string(&p)
            .await
            .map_err(|e| CoreError::io(format!("Failed to read storage: {}", e)))?;
        Ok(serde_json::from_str(&c).unwrap_or_else(|_| serde_json::json!({})))
    }

    /// Save app storage (merge with existing or replace).
    pub async fn save_app_storage(
        &self,
        app_id: &str,
        key: &str,
        value: serde_json::Value,
    ) -> CoreResult<()> {
        let _guard = self.snapshot_lock.write().await;
        self.ensure_app_dir_unlocked(app_id).await?;
        let mut current = self.load_app_storage(app_id).await?;
        let obj = current
            .as_object_mut()
            .ok_or_else(|| CoreError::validation("App storage is not an object".to_string()))?;
        obj.insert(key.to_string(), value);
        let p = self.storage_path(app_id);
        let json = serde_json::to_string_pretty(&current).map_err(CoreError::from)?;
        tokio::fs::write(&p, json)
            .await
            .map_err(|e| CoreError::io(format!("Failed to write storage: {}", e)))?;
        Ok(())
    }

    /// Delete Product App Runtime Host surface directory entirely.
    pub async fn delete(&self, app_id: &str) -> CoreResult<()> {
        let _guard = self.snapshot_lock.write().await;
        let dir = self.app_dir(app_id);
        if dir.exists() {
            tokio::fs::remove_dir_all(&dir)
                .await
                .map_err(|e| CoreError::io(format!("Failed to delete Product App dir: {}", e)))?;
        }
        Ok(())
    }

    /// List version numbers that have snapshots.
    pub async fn list_versions(&self, app_id: &str) -> CoreResult<Vec<u32>> {
        let vdir = self.app_dir(app_id).join(VERSIONS_DIR);
        if !vdir.exists() {
            return Ok(Vec::new());
        }
        let mut versions = Vec::new();
        let mut read_dir = tokio::fs::read_dir(&vdir)
            .await
            .map_err(|e| CoreError::io(format!("Failed to read versions dir: {}", e)))?;
        while let Some(entry) = read_dir
            .next_entry()
            .await
            .map_err(|e| CoreError::io(format!("Failed to read versions entry: {}", e)))?
        {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('v') && name.ends_with(".json") {
                if let Ok(n) = name[1..name.len() - 5].parse::<u32>() {
                    versions.push(n);
                }
            }
        }
        versions.sort();
        Ok(versions)
    }

    /// Load a specific version snapshot.
    pub async fn load_version(
        &self,
        app_id: &str,
        version: u32,
    ) -> CoreResult<ProductAppRuntimeHostSurface> {
        let p = self.version_path(app_id, version);
        let c = tokio::fs::read_to_string(&p).await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                CoreError::NotFound(format!("Version v{} not found", version))
            } else {
                CoreError::io(format!("Failed to read version: {}", e))
            }
        })?;
        serde_json::from_str(&c)
            .map_err(|e| CoreError::parse(format!("Invalid version file: {}", e)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_platform::AppIconSpec;
    use crate::infrastructure::PathManager;
    use crate::product_app_runtime_host_engine::types::{
        ProductAppRuntimeHostI18n, ProductAppRuntimeHostPermissions,
        ProductAppRuntimeHostRuntimeState,
    };

    fn test_root(name: &str) -> PathBuf {
        let sequence = SOURCE_SNAPSHOT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "sparo-runtime-host-storage-{name}-{}-{sequence}",
            std::process::id()
        ))
    }

    fn source_file(path: &str, content: &str) -> ProductAppRuntimeHostSourceFile {
        ProductAppRuntimeHostSourceFile {
            path: path.to_string(),
            kind: ProductAppRuntimeHostSourceFileKind::Script,
            content: content.to_string(),
        }
    }

    fn surface(app_id: &str) -> ProductAppRuntimeHostSurface {
        ProductAppRuntimeHostSurface {
            id: app_id.to_string(),
            name: "Snapshot test".to_string(),
            description: "Snapshot replacement fixture".to_string(),
            icon: AppIconSpec::Monogram {
                label: "ST".to_string(),
                seed: None,
                background: None,
            },
            category: "test".to_string(),
            tags: Vec::new(),
            i18n: ProductAppRuntimeHostI18n::default(),
            version: 1,
            created_at: 1,
            updated_at: 1,
            source: ProductAppRuntimeHostSource {
                html: "<main>snapshot</main>".to_string(),
                css: "main { display: block; }".to_string(),
                ui_js: "export {};".to_string(),
                worker_js: "export {};".to_string(),
                source_files: vec![
                    source_file("src/current.js", "export const value = 1;"),
                    source_file("src/stale.js", "export const stale = true;"),
                ],
                ..ProductAppRuntimeHostSource::default()
            },
            compiled_html: "<!doctype html><main>compiled</main>".to_string(),
            permissions: ProductAppRuntimeHostPermissions::default(),
            backends: Vec::new(),
            interaction: None,
            ai_context: None,
            permission_rationale: None,
            runtime: ProductAppRuntimeHostRuntimeState::default(),
        }
    }

    #[test]
    fn source_paths_must_be_portable_relative_files() {
        assert_eq!(
            sanitize_source_relative_path("src\\module.js").expect("relative source path"),
            PathBuf::from("src").join("module.js")
        );
        for invalid in [
            "",
            "../escape.js",
            "src/../escape.js",
            "/absolute.js",
            "C:\\absolute.js",
            "node_modules/dependency.js",
            "ui.js",
        ] {
            assert!(
                sanitize_source_relative_path(invalid).is_err(),
                "path should be rejected: {invalid}"
            );
        }
    }

    #[tokio::test]
    async fn save_replaces_source_snapshot_and_preserves_runtime_state() {
        let root = test_root("exact-source-snapshot");
        let _ = tokio::fs::remove_dir_all(&root).await;
        let path_manager = Arc::new(PathManager::with_user_root_for_tests(root.clone()));
        let storage = ProductAppRuntimeHostStorage::new(path_manager);
        let app_id = "snapshot-test";
        let mut app = surface(app_id);

        storage.save(&app).await.expect("save initial snapshot");
        storage
            .save_app_storage(app_id, "preserved", serde_json::json!(true))
            .await
            .expect("save runtime storage");
        storage
            .save_version(app_id, app.version, &app)
            .await
            .expect("save version snapshot");
        let dependency_marker = storage
            .app_dir(app_id)
            .join("node_modules")
            .join("dependency")
            .join("marker.txt");
        tokio::fs::create_dir_all(dependency_marker.parent().expect("dependency parent"))
            .await
            .expect("create dependency dir");
        tokio::fs::write(&dependency_marker, "preserved")
            .await
            .expect("write dependency marker");

        app.source.source_files = vec![source_file("src/current.js", "export const value = 2;")];
        app.updated_at = 2;
        storage
            .save(&app)
            .await
            .expect("replace authoritative source snapshot");

        let loaded = storage.load(app_id).await.expect("load replaced snapshot");
        assert_eq!(loaded.source.source_files.len(), 1);
        assert_eq!(loaded.source.source_files[0].path, "src/current.js");
        assert_eq!(
            loaded.source.source_files[0].content,
            "export const value = 2;"
        );
        assert!(
            !storage
                .source_dir(app_id)
                .join("src")
                .join("stale.js")
                .exists(),
            "files absent from the authoritative source snapshot must be deleted"
        );
        assert_eq!(
            storage
                .load_app_storage(app_id)
                .await
                .expect("load runtime storage")["preserved"],
            serde_json::json!(true)
        );
        assert_eq!(
            storage.list_versions(app_id).await.expect("list versions"),
            vec![1]
        );
        assert_eq!(
            tokio::fs::read_to_string(&dependency_marker)
                .await
                .expect("read dependency marker"),
            "preserved"
        );

        let mut entries = tokio::fs::read_dir(storage.app_dir(app_id))
            .await
            .expect("read app dir");
        while let Some(entry) = entries.next_entry().await.expect("read app entry") {
            assert!(
                !entry.file_name().to_string_lossy().starts_with(".source."),
                "completed source transactions must not leave staging or backup directories"
            );
        }

        tokio::fs::remove_dir_all(root)
            .await
            .expect("remove test root");
    }
}
