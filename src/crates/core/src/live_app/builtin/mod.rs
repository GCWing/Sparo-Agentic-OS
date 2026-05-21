//! Built-in Live Apps — bundled, seeded into live_apps_dir on first launch / upgrade.
//!
//! Each built-in app has a fixed id (so it can be located across runs) and a schema
//! `version`. On startup we compare the on-disk marker file `.builtin-version` with
//! the bundled version and only rewrite source files when newer code is available.
//! The user's `storage.json` is preserved across upgrades.

use crate::live_app::manager::LiveAppManager;
use crate::live_app::types::LiveAppMeta;
use crate::util::errors::{BitFunError, BitFunResult};
use chrono::Utc;
use std::sync::Arc;

const BUILTIN_MARKER: &str = ".builtin-version";

/// A built-in Live App bundled with the application binary.
pub struct BuiltinApp {
    /// Stable id used as on-disk directory name (also exposed in the gallery).
    pub id: &'static str,
    /// Schema version of the bundled assets — bump when sources change to trigger reseed.
    pub version: u32,
    pub meta_json: &'static str,
    pub html: &'static str,
    pub css: &'static str,
    pub ui_js: &'static str,
    pub worker_js: &'static str,
    pub esm_dependencies_json: &'static str,
    pub source_manifest_json: &'static str,
    pub package_json: &'static str,
    pub extra_assets: &'static [BuiltinAsset],
}

pub struct BuiltinAsset {
    pub path: &'static str,
    pub content: &'static str,
}

/// All built-in apps that ship with Sparo OS.
pub const BUILTIN_APPS: &[BuiltinApp] = &[
    BuiltinApp {
        id: "builtin-personal-desk",
        version: 2,
        meta_json: include_str!("assets/personal-desk/meta.json"),
        html: include_str!("assets/personal-desk/index.html"),
        css: include_str!("assets/personal-desk/style.css"),
        ui_js: include_str!("assets/personal-desk/ui.js"),
        worker_js: include_str!("assets/personal-desk/worker.js"),
        esm_dependencies_json: include_str!("assets/personal-desk/esm_dependencies.json"),
        source_manifest_json: r#"{"uiEntry":"ui.js","workerEntry":"worker.js","styleEntries":["style.css"],"buildMode":"inlineLegacy"}"#,
        package_json: "",
        extra_assets: &[],
    },
    BuiltinApp {
        id: "builtin-decision-board",
        version: 2,
        meta_json: include_str!("assets/decision-board/meta.json"),
        html: include_str!("assets/decision-board/index.html"),
        css: include_str!("assets/decision-board/style.css"),
        ui_js: include_str!("assets/decision-board/ui.js"),
        worker_js: include_str!("assets/decision-board/worker.js"),
        esm_dependencies_json: include_str!("assets/decision-board/esm_dependencies.json"),
        source_manifest_json: r#"{"uiEntry":"ui.js","workerEntry":"worker.js","styleEntries":["style.css"],"buildMode":"inlineLegacy"}"#,
        package_json: "",
        extra_assets: &[],
    },
    BuiltinApp {
        id: "builtin-micro-operator",
        version: 2,
        meta_json: include_str!("assets/micro-operator/meta.json"),
        html: include_str!("assets/micro-operator/index.html"),
        css: include_str!("assets/micro-operator/style.css"),
        ui_js: include_str!("assets/micro-operator/ui.js"),
        worker_js: include_str!("assets/micro-operator/worker.js"),
        esm_dependencies_json: include_str!("assets/micro-operator/esm_dependencies.json"),
        source_manifest_json: r#"{"uiEntry":"ui.js","workerEntry":"worker.js","styleEntries":["style.css"],"buildMode":"inlineLegacy"}"#,
        package_json: "",
        extra_assets: &[],
    },
    BuiltinApp {
        id: "builtin-spark-board",
        version: 8,
        meta_json: include_str!("assets/spark-board/meta.json"),
        html: include_str!("assets/spark-board/index.html"),
        css: include_str!("assets/spark-board/style.css"),
        ui_js: include_str!("assets/spark-board/ui.js"),
        worker_js: include_str!("assets/spark-board/worker.js"),
        esm_dependencies_json: include_str!("assets/spark-board/esm_dependencies.json"),
        source_manifest_json: include_str!("assets/spark-board/source_manifest.json"),
        package_json: "",
        extra_assets: &[
            BuiltinAsset {
                path: "src/state.js",
                content: include_str!("assets/spark-board/src/state.js"),
            },
            BuiltinAsset {
                path: "src/i18n.js",
                content: include_str!("assets/spark-board/src/i18n.js"),
            },
        ],
    },
    BuiltinApp {
        id: "builtin-ppt-live",
        version: 24,
        meta_json: include_str!("assets/ppt-live/meta.json"),
        html: include_str!("assets/ppt-live/index.html"),
        css: include_str!("assets/ppt-live/style.css"),
        ui_js: include_str!("assets/ppt-live/ui.js"),
        worker_js: include_str!("assets/ppt-live/worker.js"),
        esm_dependencies_json: include_str!("assets/ppt-live/esm_dependencies.json"),
        source_manifest_json: include_str!("assets/ppt-live/source_manifest.json"),
        package_json: include_str!("assets/ppt-live/package.json"),
        extra_assets: &[
            BuiltinAsset {
                path: "src/i18n.js",
                content: include_str!("assets/ppt-live/src/i18n.js"),
            },
            BuiltinAsset {
                path: "src/state.js",
                content: include_str!("assets/ppt-live/src/state.js"),
            },
            BuiltinAsset {
                path: "src/deck-ai.js",
                content: include_str!("assets/ppt-live/src/deck-ai.js"),
            },
            BuiltinAsset {
                path: "src/render.js",
                content: include_str!("assets/ppt-live/src/render.js"),
            },
            BuiltinAsset {
                path: "src/export-html.js",
                content: include_str!("assets/ppt-live/src/export-html.js"),
            },
        ],
    },
];

/// Seed all built-in Live Apps into the user data directory. Idempotent: skips apps
/// whose on-disk marker version is >= the bundled version. User's `storage.json`
/// is preserved across reseeds; source files & meta.json (without timestamps) are
/// overwritten.
pub async fn seed_builtin_live_apps(manager: &Arc<LiveAppManager>) -> BitFunResult<()> {
    for app in BUILTIN_APPS {
        if let Err(e) = seed_one(manager, app).await {
            log::warn!("seed builtin live app '{}' failed: {}", app.id, e);
        }
    }
    Ok(())
}

async fn seed_one(manager: &Arc<LiveAppManager>, app: &BuiltinApp) -> BitFunResult<()> {
    let app_dir = manager.path_manager().live_app_dir(app.id);
    let marker_path = app_dir.join(BUILTIN_MARKER);

    if let Ok(content) = tokio::fs::read_to_string(&marker_path).await {
        if let Ok(installed) = content.trim().parse::<u32>() {
            if installed >= app.version {
                return Ok(());
            }
        }
    }

    let source_dir = app_dir.join("source");
    tokio::fs::create_dir_all(&source_dir)
        .await
        .map_err(|e| BitFunError::io(format!("create dir failed: {}", e)))?;

    let mut meta: LiveAppMeta = serde_json::from_str(app.meta_json)
        .map_err(|e| BitFunError::parse(format!("invalid bundled meta.json: {}", e)))?;
    meta.id = app.id.to_string();
    let now = Utc::now().timestamp_millis();

    let meta_path = app_dir.join("meta.json");
    let preserved_created_at = match tokio::fs::read_to_string(&meta_path).await {
        Ok(existing) => serde_json::from_str::<LiveAppMeta>(&existing)
            .ok()
            .map(|m| m.created_at)
            .unwrap_or(now),
        Err(_) => now,
    };
    meta.created_at = preserved_created_at;
    meta.updated_at = now;

    let meta_json = serde_json::to_string_pretty(&meta).map_err(BitFunError::from)?;
    tokio::fs::write(&meta_path, meta_json)
        .await
        .map_err(|e| BitFunError::io(format!("write meta.json failed: {}", e)))?;

    write_file(source_dir.join("index.html"), app.html).await?;
    write_file(source_dir.join("style.css"), app.css).await?;
    write_file(source_dir.join("ui.js"), app.ui_js).await?;
    write_file(source_dir.join("worker.js"), app.worker_js).await?;
    write_file(
        source_dir.join("esm_dependencies.json"),
        app.esm_dependencies_json,
    )
    .await?;
    write_file(
        source_dir.join("source_manifest.json"),
        app.source_manifest_json,
    )
    .await?;
    for asset in app.extra_assets {
        write_file(source_dir.join(asset.path), asset.content).await?;
    }
    write_file(source_dir.join("i18n.json"), "{}").await?;

    if app.package_json.trim().is_empty() {
        let pkg = serde_json::json!({
            "name": format!("live-app-{}", app.id),
            "private": true,
            "dependencies": {}
        });
        let pkg_json = serde_json::to_string_pretty(&pkg).map_err(BitFunError::from)?;
        write_file(app_dir.join("package.json"), &pkg_json).await?;
    } else {
        write_file(app_dir.join("package.json"), app.package_json).await?;
    }

    let storage_path = app_dir.join("storage.json");
    if !storage_path.exists() {
        write_file(storage_path, "{}").await?;
    }

    write_file(
        app_dir.join("compiled.html"),
        "<!DOCTYPE html><html><body>Loading...</body></html>",
    )
    .await?;

    manager.recompile(app.id, "dark", None).await?;

    write_file(marker_path, &app.version.to_string()).await?;
    log::info!("seeded builtin live app '{}' (v{})", app.id, app.version);
    Ok(())
}

async fn write_file<P: AsRef<std::path::Path>>(path: P, content: &str) -> BitFunResult<()> {
    if let Some(parent) = path.as_ref().parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| {
            BitFunError::io(format!("create dir {} failed: {}", parent.display(), e))
        })?;
    }
    tokio::fs::write(path.as_ref(), content)
        .await
        .map_err(|e| BitFunError::io(format!("write {} failed: {}", path.as_ref().display(), e)))
}
