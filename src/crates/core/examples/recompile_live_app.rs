use bitfun_core::infrastructure::app_paths::PathManager;
use bitfun_core::live_app::LiveAppManager;
use std::sync::Arc;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let app_id = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "builtin-ppt-live".to_string());
    let path_manager = Arc::new(PathManager::new()?);
    let manager = Arc::new(LiveAppManager::new(path_manager));
    let app = manager.recompile(&app_id, "dark", None).await?;
    println!(
        "Recompiled live app '{}' (v{}), compiled_html_size={}",
        app.id,
        app.version,
        app.compiled_html.len()
    );
    Ok(())
}
