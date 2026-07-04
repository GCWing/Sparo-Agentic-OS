//! Sparo OS self-introspection prompt section.
//!
//! Builds the markdown block injected into the system prompt at
//! the `{SPARO_SELF}` placeholder. The goal is to make Sparo OS's own
//! capabilities (scenes, settings tabs, installed Product Apps) discoverable
//! to the model with **zero tool calls**, so it never falls back to
//! `Bash ls` against the user workspace when asked "what Product Apps do I
//! have / what scenes are there / what can Sparo OS do".
//!
//! Refresh strategy: regenerated every time a system prompt is built. The
//! Product App runtime catalog reads are cheap in-memory + metadata reads, so
//! there is no caching layer to invalidate. Anything newly installed is
//! visible to the model on the next prompt rebuild without bookkeeping.

use std::fmt::Write as _;

/// Build the Sparo OS self-introspection prompt block. Returns an empty
/// string if there is nothing useful to say (e.g. Product App subsystem not
/// initialized AND no extra context to surface) — callers should treat
/// `""` as "skip the section".
pub async fn build_bitfun_self_prompt() -> String {
    let mut out = String::new();
    out.push_str("# Sparo OS Self Capabilities (you are running INSIDE this app)\n");
    out.push_str(
        "When the user asks \"what Product Apps are installed / what scenes are there / how do I use Sparo OS\", \
use ControlHub `domain: \"app\"` actions FIRST. Do NOT answer those questions by listing the workspace directory \
— workspace folders belong to the user, not to Sparo OS's own catalog.\n\n",
    );

    push_scene_catalog(&mut out);
    push_settings_tab_catalog(&mut out);
    push_product_app_section(&mut out).await;

    out.push_str(
        "\n## Quick recipes\n\
- \"列一下 Product App / what Product Apps do I have\" → open scene `apps` or inspect the Product App catalog.\n\
- \"打开 Product App X\" → `ControlHub { domain: \"app\", action: \"execute_task\", params: { task: \"open_product_app\", params: { productAppId: \"<id>\" } } }`.\n\
- \"打开应用列表 / show the gallery\" → `ControlHub { domain: \"app\", action: \"execute_task\", params: { task: \"open_product_app_gallery\" } }`.\n\
- \"Sparo OS 都能干啥 / 一次列出所有能力\" → `ControlHub { domain: \"app\", action: \"app_self_describe\" }`.\n",
    );

    out
}

fn push_scene_catalog(out: &mut String) {
    out.push_str("## Available scenes (pass `id` to `open_scene`)\n");
    for (id, label_en, label_zh) in scene_catalog() {
        let _ = writeln!(out, "- `{id}` — {label_en} / {label_zh}");
    }
    out.push_str("- `app-surface:<appId>` — opens a specific installed Product App surface.\n\n");
}

fn push_settings_tab_catalog(out: &mut String) {
    out.push_str("## Settings tabs (pass `tabId` to `open_settings_tab`)\n");
    for (id, desc) in settings_tab_catalog() {
        let _ = writeln!(out, "- `{id}` — {desc}");
    }
    out.push('\n');
}

async fn push_product_app_section(out: &mut String) {
    out.push_str("## Installed Product Apps\n");
    let path_manager = match crate::infrastructure::try_get_path_manager_arc() {
        Ok(path_manager) => path_manager,
        Err(e) => {
            let _ = writeln!(
                out,
                "(Product App package subsystem is not initialized: {e})"
            );
            return;
        }
    };

    if let Err(e) = crate::app_platform::seed_builtin_product_app_packages(&path_manager).await {
        let _ = writeln!(out, "(Failed to seed built-in Product Apps: {e})");
    }

    let mut apps =
        match crate::app_platform::list_installed_product_app_catalog(&path_manager).await {
            Ok(apps) => apps,
            Err(e) => {
                let _ = writeln!(out, "(Failed to enumerate Product Apps: {e})");
                return;
            }
        };
    apps.retain(|entry| {
        entry.app.enabled
            && entry.app.catalog_visibility != crate::app_platform::AppCatalogVisibility::Hidden
    });
    apps.sort_by(|left, right| {
        left.app
            .name
            .to_lowercase()
            .cmp(&right.app.name.to_lowercase())
            .then_with(|| left.app.id.cmp(&right.app.id))
    });

    if apps.is_empty() {
        out.push_str(
            "(No Product Apps installed yet. The user can install some from the Apps scene.)\n",
        );
        return;
    }

    let _ = writeln!(out, "({} installed)", apps.len());
    for entry in apps.iter().take(40) {
        let app = &entry.app;
        let desc = if app.description.is_empty() {
            "(no description)"
        } else {
            app.description.as_str()
        };
        let launch = app
            .launch
            .as_ref()
            .map(|launch| format!("{:?}", launch.kind))
            .unwrap_or_else(|| "no launch target".to_string());
        let _ = writeln!(
            out,
            "- `{}` — {} — {} — launch: {} (open via `execute_task open_product_app productAppId=\"{}\"`)",
            app.id, app.name, desc, launch, app.id
        );
    }
    if apps.len() > 40 {
        let _ = writeln!(
            out,
            "- ... {} more (open the Apps scene to enumerate the rest).",
            apps.len() - 40
        );
    }
}

// NOTE: these two catalogs MUST stay aligned with the Rust copies in
// `control_hub_tool.rs::scene_catalog` / `settings_tab_catalog` and the
// frontend registries (`scenes/registry.ts`, settings store). The e2e
// suite already validates the `list_tasks` catalog; extend it to cover
// these as well when adding new entries.
fn scene_catalog() -> Vec<(&'static str, &'static str, &'static str)> {
    vec![
        ("welcome", "Welcome", "欢迎使用"),
        ("session", "Session (chat)", "会话"),
        ("terminal", "Terminal", "终端"),
        ("git", "Git", "Git"),
        ("settings", "Settings", "设置"),
        ("file-viewer", "File Viewer", "文件查看"),
        ("profile", "Profile", "个人资料"),
        ("agents", "Agents", "智能体"),
        ("skills", "Skills", "技能"),
        ("apps", "Apps", "应用"),
        ("browser", "Browser", "浏览器"),
        ("mermaid", "Mermaid Editor", "Mermaid 图表"),
        ("assistant", "Assistant", "助理"),
        ("insights", "Insights", "洞察"),
        ("shell", "Shell", "Shell"),
        ("panel-view", "Panel View", "面板视图"),
    ]
}

fn settings_tab_catalog() -> Vec<(&'static str, &'static str)> {
    vec![
        ("basics", "Basic preferences (language, theme, etc.)"),
        ("models", "AI models (add / edit / set defaults / delete)"),
        ("session-config", "Default session behavior"),
        ("agents", "Agent management"),
        ("skills", "Skill packages"),
        ("tools", "Built-in tools and MCP servers"),
        ("about", "About Sparo OS"),
    ]
}
