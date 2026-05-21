//! Live App Studio tools — recompile, runtime probe, and review matrix.

use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext};
use crate::infrastructure::events::{emit_global_event, BackendEvent};
use crate::live_app::try_get_global_live_app_manager;
use crate::live_app::types::{
    LiveApp, LiveAppRuntimeIssue, LiveAppRuntimeIssueSeverity, LiveAppRuntimeLog,
    LiveAppRuntimeLogLevel,
};
use crate::util::errors::{BitFunError, BitFunResult};
use async_trait::async_trait;
use chrono::Utc;
use serde_json::{json, Value};
use std::borrow::Cow;

pub struct LiveAppRecompileTool;

impl LiveAppRecompileTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for LiveAppRecompileTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for LiveAppRecompileTool {
    fn name(&self) -> &str {
        "LiveAppRecompile"
    }

    async fn description(&self) -> BitFunResult<String> {
        Ok("Sync a Live App from its source files, recompile compiled_html, and emit update events for the right-side preview.".to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["app_id"],
            "properties": {
                "app_id": { "type": "string", "description": "Live App id" },
                "theme": { "type": "string", "description": "Theme type, default dark" }
            }
        })
    }

    fn is_readonly(&self) -> bool {
        false
    }

    fn needs_permissions(&self, _input: Option<&Value>) -> bool {
        false
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let app_id = required_string(input, "app_id")?;
        let theme = input.get("theme").and_then(Value::as_str).unwrap_or("dark");
        let manager = try_get_global_live_app_manager()
            .ok_or_else(|| BitFunError::tool("LiveAppManager not initialized".to_string()))?;

        manager
            .record_runtime_log(LiveAppRuntimeLog {
                app_id: app_id.to_string(),
                level: LiveAppRuntimeLogLevel::Info,
                category: "compile".to_string(),
                message: "Live App recompile started".to_string(),
                source: None,
                stack: None,
                details: Some(json!({ "theme": theme })),
                timestamp_ms: Utc::now().timestamp_millis(),
            })
            .await;

        let app = match manager
            .sync_from_fs(app_id, theme, context.workspace_root())
            .await
        {
            Ok(app) => app,
            Err(e) => {
                manager
                    .record_runtime_log(LiveAppRuntimeLog {
                        app_id: app_id.to_string(),
                        level: LiveAppRuntimeLogLevel::Error,
                        category: "compile".to_string(),
                        message: format!("Failed to sync and recompile Live App: {e}"),
                        source: None,
                        stack: None,
                        details: Some(json!({ "theme": theme })),
                        timestamp_ms: Utc::now().timestamp_millis(),
                    })
                    .await;
                return Err(BitFunError::tool(format!(
                    "Failed to sync and recompile Live App: {e}"
                )));
            }
        };

        let payload = json!({
            "id": app.id,
            "name": app.name,
            "reason": "studio-recompile",
        });
        let _ = emit_global_event(BackendEvent::Custom {
            event_name: "liveapp-runtime-errors-cleared".to_string(),
            payload: json!({ "appId": app.id }),
        })
        .await;
        let _ = emit_global_event(BackendEvent::Custom {
            event_name: "liveapp-recompiled".to_string(),
            payload: payload.clone(),
        })
        .await;
        let _ = emit_global_event(BackendEvent::Custom {
            event_name: "liveapp-updated".to_string(),
            payload,
        })
        .await;

        let warnings = collect_quality_warnings(&app);
        let data = json!({
            "ok": true,
            "app_id": app.id,
            "version": app.version,
            "compiled_html_size": app.compiled_html.len(),
            "warnings": warnings.clone(),
        });
        manager
            .record_runtime_log(LiveAppRuntimeLog {
                app_id: app.id.clone(),
                level: LiveAppRuntimeLogLevel::Info,
                category: "compile".to_string(),
                message: "Live App recompile completed".to_string(),
                source: None,
                stack: None,
                details: Some(json!({
                    "version": app.version,
                    "compiledHtmlSize": app.compiled_html.len()
                })),
                timestamp_ms: Utc::now().timestamp_millis(),
            })
            .await;
        let assistant_text = if warnings.is_empty() {
            format!(
                "Live App '{}' synced and recompiled. compiled_html_size={}",
                app.name,
                app.compiled_html.len()
            )
        } else {
            format!(
                "Live App '{}' synced and recompiled. compiled_html_size={}. Quality warnings:\n{}",
                app.name,
                app.compiled_html.len(),
                warnings
                    .iter()
                    .enumerate()
                    .map(|(index, warning)| format!("{}. {}", index + 1, warning))
                    .collect::<Vec<_>>()
                    .join("\n")
            )
        };
        Ok(vec![ToolResult::ok(data, Some(assistant_text))])
    }
}

fn collect_quality_warnings(app: &LiveApp) -> Vec<String> {
    let mut warnings = Vec::new();
    let html = app.source.html.trim();
    let css = app.source.css.trim();
    let ui_js = app.source.ui_js.trim();
    let worker_js = app.source.worker_js.trim();

    if html.is_empty() || !html.contains("<div id=\"app\"") {
        warnings.push(
            "source/index.html should expose a stable <div id=\"app\"> mount point.".to_string(),
        );
    }
    if !ui_js.contains("app.ui") && !ui_js.contains("window.app.ui") {
        warnings.push(
            "source/ui.js does not use app.ui; prefer the runtime UI Kit for routine controls."
                .to_string(),
        );
    }
    if !ui_js.contains("app.i18n.t") && !ui_js.contains("app.t(") {
        warnings.push(
            "source/ui.js does not read durable UI strings through app.i18n.t or app.t."
                .to_string(),
        );
    }
    if !ui_js.contains("app.log.") {
        warnings.push(
            "source/ui.js has no app.log instrumentation for important failures or async state transitions."
                .to_string(),
        );
    }
    if app.source.i18n_messages.get("en-US").is_none()
        || app.source.i18n_messages.get("zh-CN").is_none()
    {
        warnings.push(
            "source/i18n.json should include both en-US and zh-CN message tables.".to_string(),
        );
    }
    if app.i18n.locales.get("en-US").is_none() || app.i18n.locales.get("zh-CN").is_none() {
        warnings.push(
            "meta.json should include i18n.locales entries for both en-US and zh-CN catalog metadata."
                .to_string(),
        );
    }
    if css.contains("100vh") {
        warnings.push(
            "source/style.css uses 100vh; prefer height/min-height 100% inside the hosted iframe to avoid overflow bugs."
                .to_string(),
        );
    }
    for invalid_var in [
        "--bitfun-surface",
        "--bitfun-card",
        "--theme-bg",
        "--color-primary",
    ] {
        if css.contains(invalid_var) {
            warnings.push(format!(
                "source/style.css references unsupported theme variable {invalid_var}; map app-local aliases to documented --bitfun-app-* variables."
            ));
        }
    }
    if contains_raw_color(css) {
        warnings.push(
            "source/style.css contains raw hex/rgb colors; prefer host theme variables for light/dark compatibility."
                .to_string(),
        );
    }
    if worker_js.contains("window.")
        || worker_js.contains("window.app")
        || worker_js.contains("app.")
    {
        warnings.push(
            "source/worker.js appears to use browser window/app APIs; worker.js should export CommonJS methods only."
                .to_string(),
        );
    }
    if !app.source.npm_dependencies.is_empty()
        && !app
            .permissions
            .node
            .as_ref()
            .map(|node| node.enabled)
            .unwrap_or(false)
    {
        warnings.push(
            "package.json declares npm dependencies but permissions.node.enabled is false."
                .to_string(),
        );
    }
    if permissions_include_workspace_without_rationale(app) {
        warnings.push(
            "meta.json grants {workspace} access without a permission_rationale.".to_string(),
        );
    }
    if ui_js.contains("TODO") || ui_js.contains("mock") || ui_js.contains("fake") {
        warnings.push(
            "source/ui.js still contains TODO/mock/fake markers; replace temporary scaffolding before handoff."
                .to_string(),
        );
    }

    warnings
}

fn contains_raw_color(css: &str) -> bool {
    let bytes = css.as_bytes();
    for index in 0..bytes.len() {
        if bytes[index] == b'#' {
            let count = bytes
                .iter()
                .skip(index + 1)
                .take_while(|b| b.is_ascii_hexdigit())
                .count();
            if count == 3 || count == 6 || count == 8 {
                return true;
            }
        }
    }
    css.contains("rgb(") || css.contains("rgba(")
}

fn permissions_include_workspace_without_rationale(app: &LiveApp) -> bool {
    let includes_workspace = app
        .permissions
        .fs
        .as_ref()
        .map(|fs| {
            fs.read
                .as_ref()
                .is_some_and(|paths| paths.iter().any(|path| path == "{workspace}"))
                || fs
                    .write
                    .as_ref()
                    .is_some_and(|paths| paths.iter().any(|path| path == "{workspace}"))
        })
        .unwrap_or(false);
    includes_workspace
        && !app
            .permission_rationale
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty())
}

pub struct LiveAppRuntimeProbeTool;

impl LiveAppRuntimeProbeTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for LiveAppRuntimeProbeTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for LiveAppRuntimeProbeTool {
    fn name(&self) -> &str {
        "LiveAppRuntimeProbe"
    }

    async fn description(&self) -> BitFunResult<String> {
        Ok("Read recent runtime issues reported by a Live App iframe and bridge calls, grouped by severity.".to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["app_id"],
            "properties": {
                "app_id": { "type": "string", "description": "Live App id" },
                "since_ms": { "type": "integer", "description": "Only include issues with timestamp >= this Unix milliseconds value" },
                "include_noise": { "type": "boolean", "description": "Return noise issues instead of just a count" },
                "mode": {
                    "type": "string",
                    "enum": ["summary", "issues", "logs", "full"],
                    "description": "Runtime evidence scope. summary/issues are issue-focused; logs/full include recent runtime logs."
                },
                "include_logs": { "type": "boolean", "description": "Include recent runtime logs in addition to issues" },
                "tail": { "type": "integer", "description": "Maximum number of recent runtime logs to include, default 80" },
                "min_level": {
                    "type": "string",
                    "enum": ["debug", "info", "warn", "error"],
                    "description": "Minimum log level when logs are included, default info"
                }
            }
        })
    }

    fn is_readonly(&self) -> bool {
        true
    }

    async fn call_impl(
        &self,
        input: &Value,
        _context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let app_id = required_string(input, "app_id")?;
        let since_ms = input.get("since_ms").and_then(Value::as_i64);
        let include_noise = input
            .get("include_noise")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let mode = input
            .get("mode")
            .and_then(Value::as_str)
            .unwrap_or("summary");
        let include_logs = input
            .get("include_logs")
            .and_then(Value::as_bool)
            .unwrap_or(matches!(mode, "logs" | "full"));
        let tail = input
            .get("tail")
            .and_then(Value::as_u64)
            .map(|value| value.min(200) as usize)
            .unwrap_or(80);
        let min_level = input
            .get("min_level")
            .and_then(Value::as_str)
            .and_then(parse_log_level);
        let manager = try_get_global_live_app_manager()
            .ok_or_else(|| BitFunError::tool("LiveAppManager not initialized".to_string()))?;

        let issues = manager.runtime_issues(app_id, since_ms).await;
        let logs = if include_logs {
            manager
                .runtime_logs(app_id, since_ms, min_level, Some(tail))
                .await
        } else {
            Vec::new()
        };
        let fatal: Vec<&LiveAppRuntimeIssue> = issues
            .iter()
            .filter(|issue| issue.severity == LiveAppRuntimeIssueSeverity::Fatal)
            .collect();
        let warning: Vec<&LiveAppRuntimeIssue> = issues
            .iter()
            .filter(|issue| issue.severity == LiveAppRuntimeIssueSeverity::Warning)
            .collect();
        let noise: Vec<&LiveAppRuntimeIssue> = issues
            .iter()
            .filter(|issue| issue.severity == LiveAppRuntimeIssueSeverity::Noise)
            .collect();

        let ok = fatal.is_empty();
        let data = json!({
            "app_id": app_id,
            "fatal": fatal,
            "warning": warning,
            "noise_count": noise.len(),
            "noise": if include_noise { json!(noise) } else { Value::Null },
            "logs": logs.clone(),
            "log_count": logs.len(),
            "latest_timestamp_ms": latest_runtime_timestamp(&issues, &logs),
            "ok": ok,
        });
        let assistant_text = format_runtime_probe_for_assistant(
            app_id,
            ok,
            &fatal,
            &warning,
            &noise,
            &logs,
            include_noise,
            include_logs,
        );
        Ok(vec![ToolResult::ok(data, Some(assistant_text))])
    }
}

pub struct LiveAppClearRuntimeIssuesTool;

impl LiveAppClearRuntimeIssuesTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for LiveAppClearRuntimeIssuesTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for LiveAppClearRuntimeIssuesTool {
    fn name(&self) -> &str {
        "LiveAppClearRuntimeIssues"
    }

    async fn description(&self) -> BitFunResult<String> {
        Ok("Clear remembered runtime issues for a Live App before starting a fresh verification loop.".to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["app_id"],
            "properties": {
                "app_id": { "type": "string", "description": "Live App id" }
            }
        })
    }

    fn is_readonly(&self) -> bool {
        false
    }

    fn needs_permissions(&self, _input: Option<&Value>) -> bool {
        false
    }

    async fn call_impl(
        &self,
        input: &Value,
        _context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let app_id = required_string(input, "app_id")?;
        let manager = try_get_global_live_app_manager()
            .ok_or_else(|| BitFunError::tool("LiveAppManager not initialized".to_string()))?;

        manager.clear_runtime_issues(app_id).await;
        let payload = json!({ "appId": app_id });
        let _ = emit_global_event(BackendEvent::Custom {
            event_name: "liveapp-runtime-errors-cleared".to_string(),
            payload,
        })
        .await;

        let data = json!({
            "app_id": app_id,
            "cleared": true,
        });
        Ok(vec![ToolResult::ok(
            data,
            Some(format!(
                "Cleared remembered runtime issues for Live App '{}'. Run LiveAppRecompile and LiveAppRuntimeProbe to verify the current state.",
                app_id
            )),
        )])
    }
}

pub struct LiveAppScreenshotMatrixTool;

impl LiveAppScreenshotMatrixTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for LiveAppScreenshotMatrixTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for LiveAppScreenshotMatrixTool {
    fn name(&self) -> &str {
        "LiveAppScreenshotMatrix"
    }

    async fn description(&self) -> BitFunResult<String> {
        Ok("Prepare a 4-state Live App visual review matrix for light/dark and zh-CN/en-US, and notify the UI to capture screenshots when available.".to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["app_id"],
            "properties": {
                "app_id": { "type": "string", "description": "Live App id" }
            }
        })
    }

    fn is_readonly(&self) -> bool {
        false
    }

    fn needs_permissions(&self, _input: Option<&Value>) -> bool {
        false
    }

    async fn call_impl(
        &self,
        input: &Value,
        _context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let app_id = required_string(input, "app_id")?;
        let manager = try_get_global_live_app_manager()
            .ok_or_else(|| BitFunError::tool("LiveAppManager not initialized".to_string()))?;
        let app = manager
            .get(app_id)
            .await
            .map_err(|e| BitFunError::tool(format!("Failed to load Live App: {e}")))?;
        let timestamp = Utc::now().timestamp_millis();
        let review_dir = manager
            .path_manager()
            .live_app_dir(app_id)
            .join("_review")
            .join(timestamp.to_string());
        tokio::fs::create_dir_all(&review_dir).await?;

        let states = [
            ("light", "zh-CN"),
            ("light", "en-US"),
            ("dark", "zh-CN"),
            ("dark", "en-US"),
        ];
        let screenshots: Vec<Value> = states
            .iter()
            .map(|(theme, locale)| {
                json!({
                    "theme": theme,
                    "locale": locale,
                    "path": Value::Null,
                    "status": "capture_requested",
                })
            })
            .collect();
        let manifest = json!({
            "app_id": app.id,
            "app_name": app.name,
            "created_at": timestamp,
            "status": "capture_requested",
            "screenshots": screenshots,
        });
        let manifest_path = review_dir.join("manifest.json");
        tokio::fs::write(&manifest_path, serde_json::to_vec_pretty(&manifest)?).await?;

        let payload = json!({
            "appId": app_id,
            "manifestPath": manifest_path.to_string_lossy(),
            "reviewDir": review_dir.to_string_lossy(),
            "states": states.iter().map(|(theme, locale)| json!({ "theme": theme, "locale": locale })).collect::<Vec<_>>(),
        });
        let _ = emit_global_event(BackendEvent::Custom {
            event_name: "liveapp-screenshot-matrix-requested".to_string(),
            payload,
        })
        .await;

        let data = json!({
            "manifest_path": manifest_path.to_string_lossy(),
            "screenshots": screenshots,
            "status": "capture_requested",
        });
        Ok(vec![ToolResult::ok(
            data,
            Some(format!(
                "Screenshot matrix requested for Live App '{}'. Manifest: {}",
                app.name,
                manifest_path.to_string_lossy()
            )),
        )])
    }
}

/// `result_for_assistant` is what the model reads for tool messages; include actionable detail.
fn format_runtime_probe_for_assistant(
    app_id: &str,
    ok: bool,
    fatal: &[&LiveAppRuntimeIssue],
    warning: &[&LiveAppRuntimeIssue],
    noise: &[&LiveAppRuntimeIssue],
    logs: &[LiveAppRuntimeLog],
    include_noise: bool,
    include_logs: bool,
) -> String {
    const MAX_PER_BUCKET: usize = 24;
    const MAX_STACK_CHARS: usize = 4000;

    let mut out = format!(
        "Live App runtime probe (app_id={app_id}): ok={ok}; fatal={}; warning={}; noise={}.\n\n",
        fatal.len(),
        warning.len(),
        noise.len(),
    );
    append_issue_bucket(&mut out, "Fatal", fatal, MAX_PER_BUCKET, MAX_STACK_CHARS);
    append_issue_bucket(
        &mut out,
        "Warning",
        warning,
        MAX_PER_BUCKET,
        MAX_STACK_CHARS,
    );
    if include_noise {
        append_issue_bucket(&mut out, "Noise", noise, MAX_PER_BUCKET, MAX_STACK_CHARS);
    } else if !noise.is_empty() {
        out.push_str(&format!(
            "[Noise]\n{} noise issue(s) omitted; set include_noise=true on LiveAppRuntimeProbe to list them.\n\n",
            noise.len()
        ));
    }
    if include_logs {
        append_log_bucket(&mut out, logs);
    }

    out.trim_end().to_string()
}

fn parse_log_level(value: &str) -> Option<LiveAppRuntimeLogLevel> {
    match value {
        "debug" => Some(LiveAppRuntimeLogLevel::Debug),
        "info" => Some(LiveAppRuntimeLogLevel::Info),
        "warn" => Some(LiveAppRuntimeLogLevel::Warn),
        "error" => Some(LiveAppRuntimeLogLevel::Error),
        _ => None,
    }
}

fn latest_runtime_timestamp(
    issues: &[LiveAppRuntimeIssue],
    logs: &[LiveAppRuntimeLog],
) -> Option<i64> {
    issues
        .iter()
        .map(|issue| issue.timestamp_ms)
        .chain(logs.iter().map(|entry| entry.timestamp_ms))
        .max()
}

fn severity_fallback(sev: LiveAppRuntimeIssueSeverity) -> &'static str {
    match sev {
        LiveAppRuntimeIssueSeverity::Fatal => "fatal",
        LiveAppRuntimeIssueSeverity::Warning => "warning",
        LiveAppRuntimeIssueSeverity::Noise => "noise",
    }
}

fn truncate_utf8_bytes(s: &str, max_bytes: usize) -> Cow<'_, str> {
    if s.len() <= max_bytes {
        return Cow::Borrowed(s);
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    Cow::Owned(format!("{}... [truncated]", &s[..end]))
}

fn append_issue_bucket(
    out: &mut String,
    label: &str,
    issues: &[&LiveAppRuntimeIssue],
    max_list: usize,
    max_stack_chars: usize,
) {
    if issues.is_empty() {
        return;
    }
    out.push_str(&format!("[{label} issues]\n"));
    let take = issues.len().min(max_list);
    for (i, issue) in issues.iter().take(take).enumerate() {
        let cat = issue
            .category
            .as_deref()
            .unwrap_or_else(|| severity_fallback(issue.severity));
        out.push_str(&format!("{}. [{}]\n", i + 1, cat));
        out.push_str(&format!("   {}\n", issue.message.replace('\r', "")));
        if let Some(src) = issue.source.as_deref() {
            out.push_str(&format!("   source: {}\n", src.replace('\r', "")));
        }
        if let Some(st) = issue.stack.as_deref() {
            let shortened = truncate_utf8_bytes(st, max_stack_chars);
            out.push_str("   stack:\n");
            for line in shortened.lines().take(120) {
                out.push_str(&format!("   {}\n", line));
            }
            if st.lines().count() > 120 || st.len() > max_stack_chars {
                out.push_str("   ...\n");
            }
        }
        out.push('\n');
    }
    if issues.len() > max_list {
        out.push_str(&format!(
            "... {} more {} issue(s) not listed (limit {} per severity).\n\n",
            issues.len() - max_list,
            label.to_lowercase(),
            max_list
        ));
    }
}

fn append_log_bucket(out: &mut String, logs: &[LiveAppRuntimeLog]) {
    if logs.is_empty() {
        out.push_str("[Runtime logs]\nNo recent runtime logs matched the probe filters.\n\n");
        return;
    }

    out.push_str("[Runtime logs]\n");
    for (i, entry) in logs.iter().enumerate() {
        out.push_str(&format!(
            "{}. [{:?}/{}] {}\n",
            i + 1,
            entry.level,
            entry.category,
            entry.message.replace('\r', "")
        ));
        if let Some(src) = entry.source.as_deref() {
            out.push_str(&format!("   source: {}\n", src.replace('\r', "")));
        }
        if let Some(details) = entry.details.as_ref() {
            out.push_str(&format!("   details: {}\n", details));
        }
        if let Some(stack) = entry.stack.as_deref() {
            let shortened = truncate_utf8_bytes(stack, 1600);
            out.push_str("   stack:\n");
            for line in shortened.lines().take(40) {
                out.push_str(&format!("   {}\n", line));
            }
        }
        out.push('\n');
    }
}

fn required_string<'a>(input: &'a Value, field: &str) -> BitFunResult<&'a str> {
    input
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| BitFunError::validation(format!("Missing required field: {field}")))
}
