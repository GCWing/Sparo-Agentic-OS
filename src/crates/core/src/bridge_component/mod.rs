//! Bridge Component packages for adapting external applications and runtimes.
//!
//! Bridge Components are siblings of Agent Components. They expose external CLI, SDK, GUI,
//! service, MCP, or daemon capabilities through Sparo-compatible surfaces.

pub mod builtin;
pub mod events;
pub mod manager;
pub mod manifest;
pub mod registry;
pub mod runtime;

pub use events::{BridgeComponentEvent, BridgeComponentRunStatus};
pub use manager::{
    BridgeComponentAgent, BridgeComponentManager, BridgeComponentRun, BridgeComponentRunResult,
};
pub use manifest::{
    BridgeComponentAction, BridgeComponentCapability, BridgeComponentConsumer,
    BridgeComponentConsumerKind, BridgeComponentKind, BridgeComponentLifecycle,
    BridgeComponentManifest, BridgeComponentPackage, BridgeComponentPermissions,
    BridgeComponentRuntime, BridgeComponentRuntimeLanguage, BridgeComponentSurfaces,
    BridgeComponentToolDefinition,
};
pub use registry::BridgeComponentRegistry;

use crate::error::{CoreError, CoreResult};
use serde_json::Value;

fn bridge_error_message(value: &Value) -> Option<String> {
    if let Some(message) = value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(message.to_string());
    }

    let object = value.as_object()?;
    for key in ["message", "detail", "error"] {
        if let Some(message) = object
            .get(key)
            .and_then(bridge_error_message)
            .filter(|value| !value.is_empty())
        {
            return Some(message);
        }
    }
    None
}

/// Convert a Bridge terminal status into the common tool-error contract.
///
/// A Bridge process can complete its transport call successfully while reporting
/// a failed business operation in `status`/`run.failed`. Every tool adapter must
/// check this boundary before emitting a successful tool result to the model.
pub fn ensure_bridge_run_completed(
    operation_label: &str,
    result: &BridgeComponentRunResult,
) -> CoreResult<()> {
    match result.status {
        BridgeComponentRunStatus::Completed => Ok(()),
        BridgeComponentRunStatus::Failed => {
            let mut parts = vec![format!(
                "{} failed during Bridge action '{}' (run {}).",
                operation_label, result.action, result.run_id
            )];
            let detail = bridge_error_message(&result.output).or_else(|| {
                result.events.iter().rev().find_map(|event| match event {
                    BridgeComponentEvent::RunFailed { error } => bridge_error_message(error),
                    _ => None,
                })
            });
            if let Some(detail) = detail {
                parts.push(detail);
            }
            if let Some(stderr) = result
                .stderr
                .as_deref()
                .map(str::trim)
                .filter(|stderr| !stderr.is_empty())
            {
                parts.push(format!("stderr: {stderr}"));
            }
            Err(CoreError::tool(parts.join(" ")))
        }
        BridgeComponentRunStatus::Cancelled => Err(CoreError::cancelled(format!(
            "{} was cancelled during Bridge action '{}' (run {}).",
            operation_label, result.action, result.run_id
        ))),
        status => Err(CoreError::tool(format!(
            "{} did not complete Bridge action '{}' (run {}): status {:?}.",
            operation_label, result.action, result.run_id, status
        ))),
    }
}

/// Build the model-facing result from the actual Bridge output.
///
/// Component-authored summaries are useful orientation, but they cannot replace
/// the grounded output: doing so hides workbook values, exported paths, revision
/// numbers, and other data the next model round needs to reason correctly.
pub fn bridge_run_result_for_assistant(
    summary: Option<&str>,
    result: &BridgeComponentRunResult,
) -> String {
    let status = format!("{:?}", result.status).to_ascii_lowercase();
    let mut parts = vec![format!(
        "Bridge status: {status}\nBridge action: {}\nBridge run: {}",
        result.action, result.run_id
    )];
    if let Some(summary) = summary.map(str::trim).filter(|summary| !summary.is_empty()) {
        parts.push(summary.to_string());
    }

    if !result.output.is_null() {
        let output = result
            .output
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| result.output.to_string());
        parts.push(format!("Bridge output:\n{output}"));
    }

    if let Some(stderr) = result
        .stderr
        .as_deref()
        .map(str::trim)
        .filter(|stderr| !stderr.is_empty())
    {
        parts.push(format!("Bridge stderr:\n{stderr}"));
    }

    parts.join("\n\n")
}

#[cfg(test)]
mod result_contract_tests {
    use super::*;
    use serde_json::json;

    fn bridge_result(status: BridgeComponentRunStatus, output: Value) -> BridgeComponentRunResult {
        BridgeComponentRunResult {
            component_id: "builtin-excel-runtime".to_string(),
            capability_id: Some("sparo.excelEngine".to_string()),
            action: "proposePatch".to_string(),
            run_id: "bridge-run-test".to_string(),
            status,
            events: Vec::new(),
            output,
            stderr: None,
        }
    }

    #[test]
    fn failed_run_returns_tool_error_with_business_failure() {
        let result = bridge_result(
            BridgeComponentRunStatus::Failed,
            json!({
                "message": "[REVISION_CONFLICT] expected revision 11, workbook is at 12"
            }),
        );

        let error = ensure_bridge_run_completed("Spreadsheet patch", &result).unwrap_err();

        assert!(matches!(error, CoreError::Tool(_)));
        assert!(error.to_string().contains("REVISION_CONFLICT"));
        assert!(error.to_string().contains("proposePatch"));
    }

    #[test]
    fn failed_event_supplies_error_when_output_is_empty() {
        let mut result = bridge_result(BridgeComponentRunStatus::Failed, Value::Null);
        result.events.push(BridgeComponentEvent::RunFailed {
            error: json!({ "message": "Spreadsheet engine rejected the patch" }),
        });

        let error = ensure_bridge_run_completed("Spreadsheet patch", &result).unwrap_err();

        assert!(error
            .to_string()
            .contains("Spreadsheet engine rejected the patch"));
    }

    #[test]
    fn successful_assistant_result_contains_grounded_bridge_output() {
        let result = bridge_result(
            BridgeComponentRunStatus::Completed,
            json!({ "revision": 12, "proposalId": "proposal-1" }),
        );

        ensure_bridge_run_completed("Spreadsheet patch", &result).unwrap();
        let assistant_result = bridge_run_result_for_assistant(
            Some("Proposed a spreadsheet patch for review."),
            &result,
        );

        assert!(assistant_result.contains("Proposed a spreadsheet patch for review."));
        assert!(assistant_result.contains("Bridge status: completed"));
        assert!(assistant_result.contains("Bridge action: proposePatch"));
        assert!(assistant_result.contains("Bridge run: bridge-run-test"));
        assert!(assistant_result.contains("\"revision\":12"));
        assert!(assistant_result.contains("\"proposalId\":\"proposal-1\""));
    }
}
