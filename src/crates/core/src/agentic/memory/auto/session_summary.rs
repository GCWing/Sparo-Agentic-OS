use crate::agentic::memory::prompts::render_session_summary_prompt;
use crate::agentic::memory::store::format_path_for_prompt;
use crate::error::CoreResult;
use std::path::Path;

pub fn build_session_summary_prompt(session_summary_path: &Path) -> CoreResult<String> {
    let summary_path = format_path_for_prompt(session_summary_path);

    Ok(render_session_summary_prompt(&summary_path))
}
