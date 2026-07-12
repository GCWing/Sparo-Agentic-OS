//! Sparo OS self-introspection prompt section.
//!
//! The prompt is rebuilt for each system prompt so active Intelligent App
//! Releases are discoverable without asking the model to inspect user files.

use std::fmt::Write as _;

pub async fn build_sparo_self_prompt() -> String {
    let mut out = String::new();
    out.push_str("# Sparo OS Self Capabilities (you are running inside this app)\n");
    out.push_str(
        "When the user asks what Intelligent Apps or scenes are available, use ControlHub `domain: \"app\"` actions first. User workspace files are not the Sparo OS App catalog.\n\n",
    );

    push_scene_catalog(&mut out);
    push_settings_tab_catalog(&mut out);
    push_intelligent_app_section(&mut out).await;

    out.push_str(
        "\n## Quick recipes\n\
- \"列出智能应用 / what Intelligent Apps do I have\" → open scene `apps`.\n\
- \"打开智能应用 X\" → `ControlHub { domain: \"app\", action: \"execute_task\", params: { task: \"open_product_app\", params: { productAppId: \"<id>\" } } }`.\n\
- \"打开应用中心 / show the gallery\" → `ControlHub { domain: \"app\", action: \"execute_task\", params: { task: \"open_product_app_gallery\" } }`.\n\
- \"Sparo OS 都能做什么\" → `ControlHub { domain: \"app\", action: \"app_self_describe\" }`.\n",
    );
    out
}

fn push_scene_catalog(out: &mut String) {
    out.push_str("## Available scenes (pass `id` to `open_scene`)\n");
    for (id, label_en, label_zh) in scene_catalog() {
        let _ = writeln!(out, "- `{id}` — {label_en} / {label_zh}");
    }
    out.push_str("- `app-surface:<appId>` — opens an active Intelligent App surface.\n\n");
}

fn push_settings_tab_catalog(out: &mut String) {
    out.push_str("## Settings tabs (pass `tabId` to `open_settings_tab`)\n");
    for (id, description) in settings_tab_catalog() {
        let _ = writeln!(out, "- `{id}` — {description}");
    }
    out.push('\n');
}

async fn push_intelligent_app_section(out: &mut String) {
    out.push_str("## Active Intelligent Apps\n");
    let path_manager = match crate::infrastructure::try_get_path_manager_arc() {
        Ok(path_manager) => path_manager,
        Err(error) => {
            let _ = writeln!(
                out,
                "(Intelligent App registry is not initialized: {error})"
            );
            return;
        }
    };
    let revision_store =
        match crate::app_platform::AppRevisionStore::open(path_manager.app_root()).await {
            Ok(store) => store,
            Err(error) => {
                let _ = writeln!(
                    out,
                    "(Failed to open the Intelligent App registry: {error})"
                );
                return;
            }
        };
    let catalog = revision_store
        .list_catalog(&crate::app_platform::AppActivationScope::System)
        .await;
    let mut apps = catalog
        .slots
        .into_iter()
        .filter_map(|slot| {
            let activation = slot.activation?;
            if !activation.enabled {
                return None;
            }
            let variant = slot
                .variants
                .into_iter()
                .find(|variant| variant.app.app_id == activation.selected_app_id)?;
            let release = variant
                .releases
                .into_iter()
                .find(|release| release.release_id == activation.active_release_id)?;
            Some((variant.app, release))
        })
        .collect::<Vec<_>>();
    apps.sort_by(|(left, _), (right, _)| {
        left.display_name
            .to_lowercase()
            .cmp(&right.display_name.to_lowercase())
            .then_with(|| left.app_id.cmp(&right.app_id))
    });

    if apps.is_empty() {
        out.push_str("(No Intelligent App Release is active.)\n");
        return;
    }

    let _ = writeln!(out, "({} active)", apps.len());
    for (app, release) in apps.iter().take(40) {
        let description = app.description.as_deref().unwrap_or("(no description)");
        let _ = writeln!(
            out,
            "- `{}` — {} — {} — active Release `{}`",
            app.app_id, app.display_name, description, release.release_id
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

// Keep these catalogs aligned with ControlHub and the frontend registries.
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
        ("models", "AI models (add, edit, set defaults, delete)"),
        ("session-config", "Default session behavior"),
        ("agents", "Agent management"),
        ("skills", "Skill packages"),
        ("tools", "Built-in tools and MCP servers"),
        ("about", "About Sparo OS"),
    ]
}
