//! Live App compiler 鈥?assemble source (html/css/ui_js) + Import Map + Runtime Adapter + CSP into compiled_html.

use crate::live_app::bridge_builder::{
    build_bridge_script, build_csp_content, build_import_map, build_live_app_default_theme_css,
    scroll_boundary_script,
};
use crate::live_app::runtime_ui_kit::{build_runtime_ui_kit_css, build_runtime_ui_kit_script};
use crate::live_app::types::{
    LiveAppBuildMode, LiveAppPermissions, LiveAppSource, LiveAppSourceFileKind,
};
use crate::util::errors::{BitFunError, BitFunResult};
use base64::{engine::general_purpose, Engine as _};
use std::collections::HashMap;

/// Compile Live App source into full HTML with Import Map, Runtime Adapter, and CSP injected.
pub fn compile(
    source: &LiveAppSource,
    permissions: &LiveAppPermissions,
    app_id: &str,
    app_data_dir: &str,
    workspace_dir: &str,
    theme: &str,
) -> BitFunResult<String> {
    let platform = if cfg!(target_os = "windows") {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    };

    let i18n_messages_json = serde_json::to_string(&source.i18n_messages)
        .unwrap_or_else(|_| "{}".to_string())
        .replace("</script", "<\\/script");
    let bridge = build_bridge_script(
        app_id,
        app_data_dir,
        workspace_dir,
        theme,
        platform,
        &i18n_messages_json,
    );
    let csp = build_csp_content(permissions);
    let csp_tag = format!(
        "<meta http-equiv=\"Content-Security-Policy\" content=\"{}\">",
        csp.replace('"', "&quot;")
    );
    let scroll = scroll_boundary_script();
    let theme_default_style = build_live_app_default_theme_css();
    let runtime_ui_kit_style = build_runtime_ui_kit_css();
    let import_map = build_import_map(&source.esm_dependencies);
    let css = build_style_content(source);
    let style_tag = if css.is_empty() {
        String::new()
    } else {
        format!("<style>\n{}\n</style>", css)
    };
    let bridge_script_tag = format!("<script>\n{}\n</script>", bridge);
    let runtime_ui_kit_script = build_runtime_ui_kit_script();
    let user_script_tag = build_user_script_tag(source)?;

    let head_content = format!(
        "\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n",
        theme_default_style,
        runtime_ui_kit_style,
        csp_tag,
        scroll,
        import_map,
        bridge_script_tag,
        runtime_ui_kit_script,
        style_tag,
    );

    let html = if source.html.trim().is_empty() {
        let theme_attr = format!(" data-theme-type=\"{}\"", escape_html_attr(theme));
        format!(
            r#"<!DOCTYPE html>
<html{theme_attr}>
<head>{head}</head>
<body>
{user_script}
</body>
</html>"#,
            theme_attr = theme_attr,
            head = head_content,
            user_script = user_script_tag,
        )
    } else {
        let html = strip_compiled_entry_scripts(source);
        let with_theme = inject_data_theme_type(&html, theme);
        let with_head = inject_into_head(&with_theme, &head_content)?;
        inject_before_body_close(&with_head, &user_script_tag)
    };

    Ok(html)
}

fn strip_compiled_entry_scripts(source: &LiveAppSource) -> String {
    match source.entry.build_mode {
        LiveAppBuildMode::InlineLegacy => source.html.clone(),
        LiveAppBuildMode::NativeEsm | LiveAppBuildMode::Bundled => {
            strip_script_tags_for_src(&source.html, &source.entry.ui_entry)
        }
    }
}

fn strip_script_tags_for_src(html: &str, entry: &str) -> String {
    let mut output = String::with_capacity(html.len());
    let mut cursor = 0;
    let entry = normalize_source_path(entry);

    while let Some(relative_start) = html[cursor..].to_lowercase().find("<script") {
        let start = cursor + relative_start;
        let Some(open_end_relative) = html[start..].find('>') else {
            break;
        };
        let open_end = start + open_end_relative + 1;
        let open_tag = &html[start..open_end];
        let Some(src) = script_src_value(open_tag) else {
            output.push_str(&html[cursor..open_end]);
            cursor = open_end;
            continue;
        };

        let normalized_src = normalize_source_path(&src);
        let is_entry_script = normalized_src == entry
            || (entry == "ui.js" && normalized_src == "ui.js")
            || normalized_src.ends_with(&format!("/{}", entry));
        if !is_entry_script {
            output.push_str(&html[cursor..open_end]);
            cursor = open_end;
            continue;
        }

        output.push_str(&html[cursor..start]);
        let lower_tail = html[open_end..].to_lowercase();
        if let Some(close_relative) = lower_tail.find("</script>") {
            cursor = open_end + close_relative + "</script>".len();
        } else {
            cursor = open_end;
        }
    }

    output.push_str(&html[cursor..]);
    output
}

fn script_src_value(open_tag: &str) -> Option<String> {
    let lower = open_tag.to_lowercase();
    let src_pos = lower.find("src")?;
    let after_src = &open_tag[src_pos + 3..];
    let after_equals = after_src.trim_start();
    let after_equals = after_equals.strip_prefix('=')?.trim_start();
    let mut chars = after_equals.chars();
    let quote = chars.next()?;
    if quote == '"' || quote == '\'' {
        let rest = &after_equals[quote.len_utf8()..];
        let end = rest.find(quote)?;
        return Some(rest[..end].to_string());
    }
    let end = after_equals
        .find(|ch: char| ch.is_whitespace() || ch == '>')
        .unwrap_or(after_equals.len());
    Some(after_equals[..end].to_string())
}

fn build_user_script_tag(source: &LiveAppSource) -> BitFunResult<String> {
    match source.entry.build_mode {
        LiveAppBuildMode::InlineLegacy => {
            if source.ui_js.is_empty() {
                Ok(String::new())
            } else {
                Ok(format!(
                    "<script type=\"module\">\n{}\n</script>",
                    source.ui_js
                ))
            }
        }
        LiveAppBuildMode::NativeEsm | LiveAppBuildMode::Bundled => {
            let entry = source.entry.ui_entry.trim();
            let entry_code = resolve_ui_entry_code(source, entry)?;
            let code = build_embedded_esm_entry(source, entry, &entry_code)?;
            Ok(format!("<script type=\"module\">\n{}\n</script>", code))
        }
    }
}

fn build_style_content(source: &LiveAppSource) -> String {
    let mut chunks = Vec::new();
    if !source.css.is_empty() {
        chunks.push(source.css.clone());
    }
    for entry in &source.entry.style_entries {
        if entry == "style.css" {
            continue;
        }
        if let Some(file) = source
            .source_files
            .iter()
            .find(|file| normalize_source_path(&file.path) == normalize_source_path(entry))
        {
            chunks.push(file.content.clone());
        }
    }
    chunks.join("\n\n")
}

fn resolve_ui_entry_code(source: &LiveAppSource, entry: &str) -> BitFunResult<String> {
    if entry.is_empty() || entry == "ui.js" {
        return Ok(source.ui_js.clone());
    }
    source
        .source_files
        .iter()
        .find(|file| normalize_source_path(&file.path) == normalize_source_path(entry))
        .map(|file| file.content.clone())
        .ok_or_else(|| BitFunError::validation(format!("Live App UI entry not found: {}", entry)))
}

fn build_embedded_esm_entry(
    source: &LiveAppSource,
    entry: &str,
    entry_code: &str,
) -> BitFunResult<String> {
    let mut modules: HashMap<String, String> = source
        .source_files
        .iter()
        .filter(|file| {
            file.kind == LiveAppSourceFileKind::Script
                || file.path.ends_with(".js")
                || file.path.ends_with(".mjs")
        })
        .map(|file| (normalize_source_path(&file.path), file.content.clone()))
        .collect();
    modules.insert(normalize_source_path(entry), entry_code.to_string());

    let mut urls: HashMap<String, String> = modules
        .iter()
        .map(|(path, code)| (path.clone(), javascript_data_url(code)))
        .collect();

    for _ in 0..8 {
        let mut changed = false;
        let next_urls: HashMap<String, String> = modules
            .iter()
            .map(|(path, code)| {
                let rewritten = rewrite_relative_imports(path, code, &urls);
                let url = javascript_data_url(&rewritten);
                if urls.get(path) != Some(&url) {
                    changed = true;
                }
                (path.clone(), url)
            })
            .collect();
        urls = next_urls;
        if !changed {
            break;
        }
    }

    Ok(rewrite_relative_imports(
        &normalize_source_path(entry),
        entry_code,
        &urls,
    ))
}

fn javascript_data_url(code: &str) -> String {
    format!(
        "data:text/javascript;base64,{}",
        general_purpose::STANDARD.encode(code.as_bytes())
    )
}

fn rewrite_relative_imports(
    current_path: &str,
    code: &str,
    urls: &HashMap<String, String>,
) -> String {
    let mut out = code.to_string();
    for (specifier, target) in relative_import_targets(current_path, urls) {
        for quote in ["'", "\""] {
            out = out.replace(
                &format!("{quote}{specifier}{quote}"),
                &format!("{quote}{target}{quote}"),
            );
        }
    }
    out
}

fn relative_import_targets(
    current_path: &str,
    urls: &HashMap<String, String>,
) -> Vec<(String, String)> {
    urls.iter()
        .filter_map(|(path, url)| {
            relative_specifier_between(current_path, path).map(|specifier| (specifier, url.clone()))
        })
        .collect()
}

fn relative_specifier_between(from: &str, to: &str) -> Option<String> {
    if from == to {
        return None;
    }
    let from_dir = from.rsplit_once('/').map(|(dir, _)| dir).unwrap_or("");
    if from_dir.is_empty() {
        return Some(format!("./{}", to));
    }
    to.strip_prefix(&format!("{from_dir}/"))
        .map(|rest| format!("./{}", rest))
}

fn normalize_source_path(path: &str) -> String {
    path.replace('\\', "/")
        .trim_start_matches("./")
        .trim_start_matches('/')
        .to_string()
}

/// Place content just before </body>. If no </body> found, append before </html> or at end.
fn inject_before_body_close(html: &str, content: &str) -> String {
    if content.is_empty() {
        return html.to_string();
    }
    if let Some(pos) = html.rfind("</body>") {
        let (before, after) = html.split_at(pos);
        return format!("{}\n{}\n{}", before, content, after);
    }
    if let Some(pos) = html.rfind("</html>") {
        let (before, after) = html.split_at(pos);
        return format!("{}\n{}\n{}", before, content, after);
    }
    format!("{}\n{}", html, content)
}

fn escape_html_attr(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Inject or replace data-theme-type on the first <html> tag.
fn inject_data_theme_type(html: &str, theme: &str) -> String {
    let safe = escape_html_attr(theme);
    if let Some(idx) = html.find("<html") {
        let after_html = idx + 5;
        let rest = &html[after_html..];
        if let Some(close) = rest.find('>') {
            let insert = format!(" data-theme-type=\"{}\"", safe);
            return format!(
                "{}{}>{}",
                &html[..after_html + close],
                insert,
                &html[after_html + close + 1..]
            );
        }
    }
    html.to_string()
}

fn inject_into_head(html: &str, content: &str) -> BitFunResult<String> {
    if let Some(head_start) = html.find("<head") {
        let after_head_open = if let Some(close_bracket) = html[head_start..].find('>') {
            head_start + close_bracket + 1
        } else {
            return Err(BitFunError::validation(
                "Invalid HTML: <head> not properly opened".to_string(),
            ));
        };
        let before = &html[..after_head_open];
        let after = &html[after_head_open..];
        return Ok(format!("{}{}{}", before, content, after));
    }

    if let Some(html_open) = html.find("<html") {
        let after_html_open = if let Some(close_bracket) = html[html_open..].find('>') {
            html_open + close_bracket + 1
        } else {
            return Err(BitFunError::validation(
                "Invalid HTML: <html> not properly opened".to_string(),
            ));
        };
        let before = &html[..after_html_open];
        let after = &html[after_html_open..];
        return Ok(format!("{}\n<head>{}</head>{}", before, content, after));
    }

    Ok(format!(
        r#"<!DOCTYPE html>
<html>
<head>{}</head>
<body>
{}
</body>
</html>"#,
        content, html
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_inject_into_head() {
        let html =
            r#"<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>x</body></html>"#;
        let content = "<!-- injected -->";
        let out = inject_into_head(html, content).unwrap();
        assert!(out.contains("<!-- injected -->"));
        assert!(out.contains("<meta charset"));
    }

    #[test]
    fn compile_injects_runtime_ui_kit() {
        let source = LiveAppSource {
            html: r#"<!DOCTYPE html><html><head></head><body><div id="app"></div></body></html>"#
                .to_string(),
            css: String::new(),
            ui_js: String::new(),
            esm_dependencies: Vec::new(),
            i18n_messages: serde_json::json!({}),
            worker_js: String::new(),
            npm_dependencies: Vec::new(),
            entry: Default::default(),
            source_files: Vec::new(),
        };
        let html = compile(
            &source,
            &LiveAppPermissions::default(),
            "app-id",
            "/tmp/appdata",
            "/tmp/workspace",
            "dark",
        )
        .unwrap();

        assert!(html.contains("sparo-runtime-ui-kit"));
        assert!(html.contains("window.app.ui = ui"));
        assert!(html.contains("btn-primary"));
    }

    #[test]
    fn compile_native_esm_allows_data_modules_and_removes_dev_script() {
        let source = LiveAppSource {
            html: r#"<!DOCTYPE html><html><head></head><body><div id="app"></div><script type="module" src="./ui.js"></script></body></html>"#
                .to_string(),
            css: String::new(),
            ui_js: "import { value } from './src/value.js'; window.__value = value;".to_string(),
            esm_dependencies: Vec::new(),
            i18n_messages: serde_json::json!({}),
            worker_js: String::new(),
            npm_dependencies: Vec::new(),
            entry: crate::live_app::types::LiveAppEntry {
                ui_entry: "ui.js".to_string(),
                worker_entry: Some("worker.js".to_string()),
                style_entries: vec!["style.css".to_string()],
                build_mode: LiveAppBuildMode::NativeEsm,
            },
            source_files: vec![crate::live_app::types::LiveAppSourceFile {
                path: "src/value.js".to_string(),
                kind: LiveAppSourceFileKind::Script,
                content: "export const value = 42;".to_string(),
            }],
        };
        let html = compile(
            &source,
            &LiveAppPermissions::default(),
            "app-id",
            "/tmp/appdata",
            "/tmp/workspace",
            "dark",
        )
        .unwrap();

        assert!(html.contains("script-src 'self' 'unsafe-inline' 'unsafe-eval' data: https:"));
        assert!(!html.contains("src=\"./ui.js\""));
        assert!(html.contains("data:text/javascript;base64"));
    }
}
