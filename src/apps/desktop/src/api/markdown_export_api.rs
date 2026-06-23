//! Markdown document export via the desktop system WebView.

use std::path::PathBuf;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use bitfun_webdriver::platform::{print_page, PrintOptions};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;

const EXPORT_VIEWPORT_WIDTH: u32 = 960;
const EXPORT_VIEWPORT_HEIGHT: u32 = 1280;
const RENDER_TIMEOUT_MS: u64 = 30_000;
const RENDER_SETTLE_MS: u64 = 1_000;
const EXPORT_HOST_LABEL: &str = "markdown-export-host";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportMarkdownHtmlRequest {
    pub destination_path: String,
    pub html: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportMarkdownPdfRequest {
    pub destination_path: String,
    pub html: String,
    pub options: Option<MarkdownPdfExportOptions>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownPdfExportOptions {
    pub orientation: Option<String>,
    pub scale: Option<f64>,
    pub background: Option<bool>,
    pub page_width: Option<f64>,
    pub page_height: Option<f64>,
    pub margin_top: Option<f64>,
    pub margin_bottom: Option<f64>,
    pub margin_left: Option<f64>,
    pub margin_right: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportMarkdownResponse {
    pub destination_path: String,
}

impl MarkdownPdfExportOptions {
    fn into_print_options(self) -> PrintOptions {
        PrintOptions {
            orientation: Some(self.orientation.unwrap_or_else(|| "portrait".to_string())),
            scale: Some(self.scale.unwrap_or(1.0)),
            background: Some(self.background.unwrap_or(true)),
            page_width: Some(self.page_width.unwrap_or(21.0)),
            page_height: Some(self.page_height.unwrap_or(29.7)),
            margin_top: Some(self.margin_top.unwrap_or(1.6)),
            margin_bottom: Some(self.margin_bottom.unwrap_or(1.6)),
            margin_left: Some(self.margin_left.unwrap_or(1.5)),
            margin_right: Some(self.margin_right.unwrap_or(1.5)),
            shrink_to_fit: Some(true),
            page_ranges: None,
        }
    }
}

fn ensure_parent_directory(path: &PathBuf) -> Result<(), String> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create export directory: {error}"))?;
    }
    Ok(())
}

fn write_export_text(destination_path: &str, content: &str) -> Result<(), String> {
    if destination_path.trim().is_empty() {
        return Err("Missing export destination path".to_string());
    }

    let path = PathBuf::from(destination_path);
    ensure_parent_directory(&path)?;
    std::fs::write(&path, content)
        .map_err(|error| format!("Failed to write Markdown HTML export: {error}"))
}

fn write_export_bytes(destination_path: &str, content: &[u8]) -> Result<(), String> {
    if destination_path.trim().is_empty() {
        return Err("Missing export destination path".to_string());
    }

    let path = PathBuf::from(destination_path);
    ensure_parent_directory(&path)?;
    std::fs::write(&path, content)
        .map_err(|error| format!("Failed to write Markdown PDF export: {error}"))
}

fn wrap_markdown_export_html(html: &str) -> String {
    let body = html.trim();
    let lower = body.to_ascii_lowercase();
    if lower.starts_with("<!doctype") || lower.starts_with("<html") {
        return body.to_string();
    }

    format!(
        "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><style>html,body{{margin:0;padding:0;}}</style></head><body>{body}</body></html>"
    )
}

fn file_url_for_export_html<R: tauri::Runtime>(
    app: &AppHandle<R>,
    html: &str,
) -> Result<(tauri::Url, PathBuf), String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Failed to resolve app cache dir: {error}"))?;
    let export_dir = cache_dir.join("markdown-export");
    std::fs::create_dir_all(&export_dir)
        .map_err(|error| format!("Failed to create export cache dir: {error}"))?;
    let file_path = export_dir.join(format!("document-{}.html", Uuid::new_v4()));
    std::fs::write(&file_path, html)
        .map_err(|error| format!("Failed to write export HTML: {error}"))?;
    let url = tauri::Url::from_file_path(&file_path)
        .map_err(|_| "Failed to build file URL for export webview".to_string())?;
    Ok((url, file_path))
}

fn ensure_export_host_window<R: tauri::Runtime>(
    app: &AppHandle<R>,
) -> Result<tauri::WebviewWindow<R>, String> {
    if let Some(window) = app.get_webview_window(EXPORT_HOST_LABEL) {
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
            EXPORT_VIEWPORT_WIDTH as f64,
            EXPORT_VIEWPORT_HEIGHT as f64,
        )));
        let _ = window.hide();
        return Ok(window);
    }

    let blank = "about:blank"
        .parse::<tauri::Url>()
        .map_err(|error| format!("Invalid blank URL: {error}"))?;
    let window = WebviewWindowBuilder::new(app, EXPORT_HOST_LABEL, WebviewUrl::External(blank))
        .visible(false)
        .inner_size(EXPORT_VIEWPORT_WIDTH as f64, EXPORT_VIEWPORT_HEIGHT as f64)
        .decorations(false)
        .skip_taskbar(true)
        .build()
        .map_err(|error| format!("Failed to create Markdown export webview: {error}"))?;
    let _ = window.hide();
    Ok(window)
}

async fn with_export_webview<R: tauri::Runtime, F, Fut, T>(
    app: &AppHandle<R>,
    html: String,
    task: F,
) -> Result<T, String>
where
    F: FnOnce(tauri::Webview<R>) -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    let window = ensure_export_host_window(app)?;
    let wrapped = wrap_markdown_export_html(&html);
    let (url, temp_html) = file_url_for_export_html(app, &wrapped)?;

    window
        .navigate(url)
        .map_err(|error| format!("Failed to navigate Markdown export webview: {error}"))?;

    tokio::time::sleep(Duration::from_millis(RENDER_SETTLE_MS)).await;

    let webview = app
        .get_webview(EXPORT_HOST_LABEL)
        .ok_or_else(|| format!("Markdown export webview is not ready: {EXPORT_HOST_LABEL}"))?;

    let result = task(webview).await;
    let _ = std::fs::remove_file(&temp_html);
    let _ = window.hide();
    result
}

#[tauri::command]
pub async fn export_markdown_html(
    request: ExportMarkdownHtmlRequest,
) -> Result<ExportMarkdownResponse, String> {
    write_export_text(&request.destination_path, &request.html)?;
    Ok(ExportMarkdownResponse {
        destination_path: request.destination_path,
    })
}

#[tauri::command]
pub async fn export_markdown_pdf(
    app: AppHandle,
    request: ExportMarkdownPdfRequest,
) -> Result<ExportMarkdownResponse, String> {
    let destination_path = request.destination_path.clone();
    let print_options = request.options.unwrap_or_default().into_print_options();
    let pdf_base64 = with_export_webview(&app, request.html, |webview| async move {
        print_page(webview, RENDER_TIMEOUT_MS, &print_options)
            .await
            .map_err(|error| error.message)
    })
    .await?;

    let pdf_bytes = BASE64_STANDARD
        .decode(pdf_base64.trim())
        .map_err(|error| format!("Failed to decode Markdown PDF export: {error}"))?;
    write_export_bytes(&destination_path, &pdf_bytes)?;

    Ok(ExportMarkdownResponse { destination_path })
}
