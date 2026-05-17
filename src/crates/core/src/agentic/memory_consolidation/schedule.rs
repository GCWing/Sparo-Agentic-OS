//! Consolidation scheduler.
//!
//! Registers `memory.consolidation.mid` (daily) and
//! `memory.consolidation.slow` (monthly) jobs with the global cron service.
//! Both jobs use the `AutoMemoryManager`'s workspace serialization lock so
//! they are mutually exclusive with ongoing fast extraction passes.
//!
//! Because the cron service dispatches via a session dialog turn, consolidation
//! jobs are registered with a designated "consolidation host session" — an
//! existing agent session that receives the consolidation command as user input.
//!
//! On the session side, the consolidation command text is intercepted by the
//! `ConversationCoordinator` and dispatched to `run_mid_consolidation_cycle`
//! or `run_slow_consolidation_cycle` rather than going through the normal LLM
//! turn pipeline.

use crate::service::cron::{CreateCronJobRequest, CronJobPayload, CronSchedule, CronService};
use crate::util::errors::BitFunResult;
use log::{info, warn};
use std::sync::Arc;

/// Magic command strings that the coordinator intercepts to trigger
/// consolidation passes instead of normal LLM processing.
pub const MID_CONSOLIDATION_COMMAND: &str = "/__memory_consolidation_mid__";
pub const SLOW_CONSOLIDATION_COMMAND_GLOBAL: &str = "/__memory_consolidation_slow_global__";
pub const SLOW_CONSOLIDATION_COMMAND_PROJECT: &str = "/__memory_consolidation_slow_project__";

/// Default cron expression for the daily mid-pass (03:30 local).
pub const DEFAULT_MID_CRON_EVERY_MS: u64 = 24 * 60 * 60 * 1000; // 24 h

/// Default cron expression for the monthly slow-pass (every ~30 days).
pub const DEFAULT_SLOW_CRON_EVERY_MS: u64 = 30 * 24 * 60 * 60 * 1000; // 30 days

/// Register the built-in memory consolidation cron jobs for the given session.
///
/// Safe to call multiple times; if a matching job already exists for the
/// session it is not duplicated.
pub async fn register_consolidation_jobs(
    cron: &Arc<CronService>,
    session_id: &str,
    workspace_path: &str,
) -> BitFunResult<()> {
    let existing = cron
        .list_jobs_filtered(Some(workspace_path), Some(session_id))
        .await;

    let has_mid = existing
        .iter()
        .any(|j| j.payload.text == MID_CONSOLIDATION_COMMAND);
    let has_slow_global = existing
        .iter()
        .any(|j| j.payload.text == SLOW_CONSOLIDATION_COMMAND_GLOBAL);
    let has_slow_project = existing
        .iter()
        .any(|j| j.payload.text == SLOW_CONSOLIDATION_COMMAND_PROJECT);

    if !has_mid {
        let job = cron
            .create_job(CreateCronJobRequest {
                name: "Memory consolidation (mid, daily)".to_string(),
                schedule: CronSchedule::Every {
                    every_ms: DEFAULT_MID_CRON_EVERY_MS,
                    anchor_ms: None,
                },
                payload: CronJobPayload {
                    text: MID_CONSOLIDATION_COMMAND.to_string(),
                },
                enabled: true,
                session_id: session_id.to_string(),
                workspace_path: workspace_path.to_string(),
            })
            .await;
        match job {
            Ok(j) => info!(
                "Registered mid consolidation cron job: job_id={} session_id={}",
                j.id, session_id
            ),
            Err(e) => warn!(
                "Failed to register mid consolidation cron job: session_id={} error={}",
                session_id, e
            ),
        }
    }

    if !has_slow_global {
        let job = cron
            .create_job(CreateCronJobRequest {
                name: "Memory consolidation (slow global, monthly)".to_string(),
                schedule: CronSchedule::Every {
                    every_ms: DEFAULT_SLOW_CRON_EVERY_MS,
                    anchor_ms: None,
                },
                payload: CronJobPayload {
                    text: SLOW_CONSOLIDATION_COMMAND_GLOBAL.to_string(),
                },
                enabled: true,
                session_id: session_id.to_string(),
                workspace_path: workspace_path.to_string(),
            })
            .await;
        match job {
            Ok(j) => info!(
                "Registered slow global consolidation cron job: job_id={} session_id={}",
                j.id, session_id
            ),
            Err(e) => warn!(
                "Failed to register slow global consolidation cron job: session_id={} error={}",
                session_id, e
            ),
        }
    }

    if !has_slow_project {
        let job = cron
            .create_job(CreateCronJobRequest {
                name: "Memory consolidation (slow project, monthly)".to_string(),
                schedule: CronSchedule::Every {
                    every_ms: DEFAULT_SLOW_CRON_EVERY_MS,
                    anchor_ms: None,
                },
                payload: CronJobPayload {
                    text: SLOW_CONSOLIDATION_COMMAND_PROJECT.to_string(),
                },
                enabled: true,
                session_id: session_id.to_string(),
                workspace_path: workspace_path.to_string(),
            })
            .await;
        match job {
            Ok(j) => info!(
                "Registered slow project consolidation cron job: job_id={} session_id={}",
                j.id, session_id
            ),
            Err(e) => warn!(
                "Failed to register slow project consolidation cron job: session_id={} error={}",
                session_id, e
            ),
        }
    }

    Ok(())
}
