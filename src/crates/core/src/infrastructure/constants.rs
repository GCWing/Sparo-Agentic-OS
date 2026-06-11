//! Cross-crate single-source constants.
//!
//! Centralizes identifiers, ports, and event keys that must agree across the
//! Rust desktop shell, the Vite dev server, the web UI, and the Tauri config.

pub const APP_IDENTIFIER: &str = "com.sparo-os.desktop";
pub const APP_PRODUCT_NAME: &str = "Sparo OS";

pub const DEV_VITE_PORT: u16 = 5722;
pub const DEV_VITE_HMR_PORT: u16 = 5721;
pub const DEFAULT_INGEST_PORT: u16 = 7242;

pub const WINDOW_MAIN: &str = "main";
pub const WINDOW_AGENT_COMPANION: &str = "agent-companion-pet";

pub const EVENT_BOOT_STAGE: &str = "boot://stage";
pub const EVENT_TRAY_NEW_SESSION: &str = "tray://new-session";
pub const EVENT_TRAY_RESTORE_SESSION: &str = "tray://restore-session";
pub const EVENT_SYSTEM_NOTIFICATION: &str = "system://notification";
pub const EVENT_AGENT_COMPANION_OPEN_LATEST_TASK: &str = "agent-companion://open-latest-task";
pub const EVENT_AGENT_COMPANION_OPEN_SETTINGS: &str = "agent-companion://open-settings";
pub const EVENT_AGENT_COMPANION_SETTINGS_UPDATED: &str = "agent-companion://settings-updated";

pub const SUBSCRIBER_KEY_TOKEN_USAGE: &str = "token_usage";
pub const SUBSCRIBER_KEY_CRON_JOBS: &str = "cron_jobs";
pub const SUBSCRIBER_KEY_HOST_AUTO_SCAN: &str = "host_auto_scan";
pub const SUBSCRIBER_KEY_GLOBAL_DAILY_REPORT: &str = "global_daily_report";
pub const SUBSCRIBER_KEY_GLOBAL_MILESTONE: &str = "global_milestone";
pub const SUBSCRIBER_KEY_TRAY_STATUS: &str = "tray_status";
pub const SUBSCRIBER_KEY_WORKSPACE_OVERVIEW_AUTO_REFRESH: &str = "workspace_overview_auto_refresh";
pub const SUBSCRIBER_KEY_AGENTIC_OS_WORK: &str = "agentic_os_work";

pub const fn dev_vite_url() -> &'static str {
    "http://localhost:5722"
}
