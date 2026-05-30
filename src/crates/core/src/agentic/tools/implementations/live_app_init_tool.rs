//! InitLiveApp tool - create a new Live App starter; AI then edits the app files.

use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext};
use crate::infrastructure::events::{emit_global_event, BackendEvent};
use crate::live_app::try_get_global_live_app_manager;
use crate::live_app::types::{
    FsPermissions, LiveAppI18n, LiveAppLocalizedMeta, LiveAppPermissions, LiveAppSource,
    NetPermissions, NodePermissions, ShellPermissions,
};
use crate::util::errors::{BitFunError, BitFunResult};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::collections::HashMap;

const SKELETON_HTML: &str = r#"<!DOCTYPE html>
<html lang="en" data-theme-type="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
  <div id="app"></div>
</body>
</html>"#;

const SKELETON_UI_JS: &str = r#"const root = document.getElementById('app');
const { Button, Card, CardHeader, CardBody, Empty, Stack, Toolbar, Badge, mount } = app.ui;

let items = [];
let busy = false;

function t(key, params, fallback) {
  return app.i18n.t(key, params, fallback);
}

async function loadItems() {
  try {
    const stored = await app.storage.get('items');
    items = Array.isArray(stored) ? stored : [];
    app.log.info('Loaded Live App state', { count: items.length });
  } catch (error) {
    app.log.warn('Failed to load stored state', { error: error && error.message ? error.message : String(error) });
    items = [];
  }
}

async function saveItems() {
  try {
    await app.storage.set('items', items);
  } catch (error) {
    app.log.error('Failed to save Live App state', { error: error && error.message ? error.message : String(error) });
  }
}

function setBusy(value) {
  busy = value;
  render();
}

async function addItem() {
  const title = window.prompt(t('prompt.itemTitle', {}, 'New item'));
  if (!title || !title.trim()) return;
  setBusy(true);
  items = [{ id: crypto.randomUUID(), title: title.trim(), createdAt: Date.now() }, ...items];
  await saveItems();
  app.log.info('Added item', { count: items.length });
  setBusy(false);
}

async function clearItems() {
  if (!items.length) return;
  items = [];
  await saveItems();
  app.log.info('Cleared items');
  render();
}

function itemNode(item) {
  const node = document.createElement('li');
  node.className = 'item-row';
  const title = document.createElement('span');
  title.className = 'item-row__title';
  title.textContent = item.title;
  const meta = document.createElement('span');
  meta.className = 'item-row__meta';
  meta.textContent = new Intl.DateTimeFormat(app.locale || 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(item.createdAt));
  node.append(title, meta);
  return node;
}

function renderItems() {
  if (!items.length) {
    return Empty({
      title: t('empty.title', {}, 'Nothing here yet'),
      description: t('empty.description', {}, 'Add the first item to verify storage, layout, and actions.'),
    });
  }
  const list = document.createElement('ul');
  list.className = 'item-list';
  items.forEach((item) => list.appendChild(itemNode(item)));
  return list;
}

function render() {
  const shell = document.createElement('main');
  shell.className = 'app-shell';
  shell.appendChild(Card({
    className: 'workspace-card',
    padding: 'large',
    children: [
      CardHeader({
        title: t('title', {}, 'Live App'),
        subtitle: t('subtitle', {}, 'A focused workspace ready for your custom workflow.'),
        extra: Badge({ text: t('badge.ready', {}, 'Ready'), variant: 'success' }),
      }),
      CardBody({
        children: Stack({
          gap: 14,
          children: [
            Toolbar({
              children: [
                Button({
                  text: busy ? t('actions.saving', {}, 'Saving...') : t('actions.add', {}, 'Add item'),
                  onClick: addItem,
                  loading: busy,
                }),
                Button({
                  text: t('actions.clear', {}, 'Clear'),
                  variant: 'secondary',
                  onClick: clearItems,
                  disabled: busy || !items.length,
                }),
              ],
            }),
            renderItems(),
          ],
        }),
      }),
    ],
  }));
  mount(root, shell);
}

app.i18n.onChange(() => render());

await loadItems();
render();
"#;

const SKELETON_WORKER_JS: &str = r#"// Node.js Worker. Keep this disabled unless the app needs npm packages or Node-only work.
module.exports = {};
"#;

const SKELETON_CSS: &str = r#"/* Live App design baseline: host theme, compact workspace, no decorative filler. */
* { box-sizing: border-box; margin: 0; padding: 0; }
html,
body {
  min-height: 100%;
}
body {
  font-family: var(--sparo-font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif);
  font-size: 13px;
  color: var(--sparo-app-text);
  background: var(--sparo-app-bg);
}
#app {
  min-height: 100%;
}
.app-shell {
  width: min(760px, 100%);
  margin: 0 auto;
  padding: 16px;
}
.workspace-card {
  min-height: 360px;
}
.item-list {
  display: grid;
  gap: 8px;
  list-style: none;
}
.item-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 40px;
  padding: 10px 12px;
  border: 1px solid var(--sparo-app-border-subtle);
  border-radius: var(--sparo-app-radius);
  background: var(--sparo-app-panel);
}
.item-row__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--sparo-app-text);
}
.item-row__meta {
  flex: 0 0 auto;
  color: var(--sparo-app-text-muted);
  font-size: 12px;
}
@media (max-width: 560px) {
  .app-shell {
    padding: 12px;
  }
  .item-row {
    align-items: flex-start;
    flex-direction: column;
  }
}
"#;

fn skeleton_i18n_messages(name: &str, description: &str) -> Value {
    let subtitle_en = if description.trim().is_empty() {
        "A focused workspace ready for your custom workflow."
    } else {
        description
    };
    let subtitle_zh = if description.trim().is_empty() {
        "一个已经接好存储、操作和状态反馈的工作区。"
    } else {
        description
    };

    json!({
        "en-US": {
            "title": name,
            "subtitle": subtitle_en,
            "badge.ready": "Ready",
            "actions.add": "Add item",
            "actions.clear": "Clear",
            "actions.saving": "Saving...",
            "empty.title": "Nothing here yet",
            "empty.description": "Add the first item to verify storage, layout, and actions.",
            "prompt.itemTitle": "New item"
        },
        "zh-CN": {
            "title": name,
            "subtitle": subtitle_zh,
            "badge.ready": "就绪",
            "actions.add": "添加项目",
            "actions.clear": "清空",
            "actions.saving": "保存中...",
            "empty.title": "这里还没有内容",
            "empty.description": "添加第一个项目，验证存储、布局和操作是否正常。",
            "prompt.itemTitle": "新项目"
        }
    })
}

fn skeleton_meta_i18n(name: &str, description: &str) -> LiveAppI18n {
    let description = description.trim();
    let mut locales = HashMap::new();
    locales.insert(
        "en-US".to_string(),
        LiveAppLocalizedMeta {
            name: Some(name.to_string()),
            description: (!description.is_empty()).then(|| description.to_string()),
            tags: Vec::new(),
        },
    );
    locales.insert(
        "zh-CN".to_string(),
        LiveAppLocalizedMeta {
            name: Some(name.to_string()),
            description: (!description.is_empty()).then(|| description.to_string()),
            tags: Vec::new(),
        },
    );
    LiveAppI18n { locales }
}

pub struct InitLiveAppTool;

impl InitLiveAppTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for InitLiveAppTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for InitLiveAppTool {
    fn name(&self) -> &str {
        "InitLiveApp"
    }

    async fn description(&self) -> BitFunResult<String> {
        Ok(r#"Create a new Live App starter in the Toolbox. After creation, use Read/Write/Edit file tools to modify the source files directly.

Input: name, description, icon, category. The tool creates the app directory and product-ready starter files:
- manifest (meta.json), source/index.html, source/style.css, source/ui.js, source/worker.js,
  source/i18n.json, package.json, storage.json.

Returns app_id and the app root directory. Use the root directory and file names above with Read/Write/Edit to implement the app. The starter already includes app.ui controls, app.storage persistence, app.log instrumentation, and zh-CN/en-US runtime i18n. Keep those patterns when replacing the starter workflow with the requested app. When available, load the liveapp-dev skill for the packaged API and design baseline."#
            .to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["name"],
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Short app name (e.g. 'Image Compressor', 'Markdown Viewer')"
                },
                "description": {
                    "type": "string",
                    "description": "One-sentence description. Default empty."
                },
                "icon": {
                    "type": "string",
                    "description": "Lucide icon identifier, such as 'box' or 'sparkles'. Default 'box'."
                },
                "category": {
                    "type": "string",
                    "description": "Category: utility, media, dev, productivity. Default 'utility'."
                }
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
        let manager = try_get_global_live_app_manager()
            .ok_or_else(|| BitFunError::tool("LiveAppManager not initialized".to_string()))?;

        let name = input
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| BitFunError::validation("Missing required field: name"))?
            .to_string();
        let description = input
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let icon = input
            .get("icon")
            .and_then(|v| v.as_str())
            .unwrap_or("box")
            .to_string();
        let category = input
            .get("category")
            .and_then(|v| v.as_str())
            .unwrap_or("utility")
            .to_string();

        let source = LiveAppSource {
            html: SKELETON_HTML.to_string(),
            css: SKELETON_CSS.to_string(),
            ui_js: SKELETON_UI_JS.to_string(),
            esm_dependencies: Vec::new(),
            i18n_messages: skeleton_i18n_messages(&name, &description),
            worker_js: SKELETON_WORKER_JS.to_string(),
            npm_dependencies: Vec::new(),
            entry: Default::default(),
            source_files: Vec::new(),
        };

        let permissions = LiveAppPermissions {
            fs: Some(FsPermissions {
                read: Some(vec!["{appdata}".to_string()]),
                write: Some(vec!["{appdata}".to_string()]),
            }),
            shell: Some(ShellPermissions {
                allow: Some(Vec::new()),
            }),
            net: Some(NetPermissions {
                allow: Some(Vec::new()),
            }),
            node: Some(NodePermissions {
                enabled: false,
                max_memory_mb: None,
                timeout_ms: None,
            }),
            ai: None,
        };

        let app = manager
            .create(
                name.clone(),
                description.clone(),
                icon,
                category,
                Vec::new(),
                skeleton_meta_i18n(&name, &description),
                source,
                permissions,
                Vec::new(),
                None,
                None,
                context.workspace_root(),
            )
            .await
            .map_err(|e| BitFunError::tool(format!("Failed to create Live App: {}", e)))?;

        let path_manager = manager.path_manager();
        let app_dir = path_manager.live_app_dir(&app.id);
        let app_dir_str = app_dir.to_string_lossy().to_string();
        let source_dir = app_dir.join("source");

        let files = json!({
            "manifest": app_dir.join("meta.json").to_string_lossy(),
            "ui": source_dir.join("ui.js").to_string_lossy(),
            "worker": source_dir.join("worker.js").to_string_lossy(),
            "style": source_dir.join("style.css").to_string_lossy(),
            "html": source_dir.join("index.html").to_string_lossy(),
            "i18n": source_dir.join("i18n.json").to_string_lossy(),
            "package": app_dir.join("package.json").to_string_lossy(),
        });

        let _ = emit_global_event(BackendEvent::Custom {
            event_name: "liveapp-created".to_string(),
            payload: json!({ "id": app.id, "name": app.name, "sessionId": context.session_id }),
        })
        .await;

        let result_text = format!(
            "Live App '{}' starter created. app_id: {}. Root directory: {}. Edit files under source/, then run LiveAppRecompile and LiveAppRuntimeProbe.",
            app.name, app.id, app_dir_str
        );

        Ok(vec![ToolResult::Result {
            data: json!({
                "app_id": app.id,
                "path": app_dir_str,
                "files": files,
            }),
            result_for_assistant: Some(result_text),
            image_attachments: None,
        }])
    }
}
