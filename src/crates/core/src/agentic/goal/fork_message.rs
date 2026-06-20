use super::instructions::{
    extraction_output_schema, judge_output_schema, GOAL_EXTRACTION_INSTRUCTION,
    GOAL_EXTRACTION_INSTRUCTION_VERSION, GOAL_JUDGE_INSTRUCTION, GOAL_JUDGE_INSTRUCTION_VERSION,
};
use super::intake::GoalTextIntake;
use super::model::{
    GoalExtractionPayload, GoalExtractionRequestMessage, GoalJudgeRequestMessage, GoalRecord,
    GoalRecordSummary,
};
use std::fmt::Write as _;

pub struct GoalForkMessageBuilder;

impl GoalForkMessageBuilder {
    pub fn extraction_request(
        extraction_id: String,
        intake: &GoalTextIntake,
        active_goal: Option<&GoalRecord>,
    ) -> GoalExtractionRequestMessage {
        GoalExtractionRequestMessage {
            extraction_id,
            instruction_version: GOAL_EXTRACTION_INSTRUCTION_VERSION.to_string(),
            fixed_instruction: GOAL_EXTRACTION_INSTRUCTION.to_string(),
            payload: GoalExtractionPayload {
                raw_input: intake.raw_input.clone(),
                entry: intake.entry.clone(),
                active_goal: active_goal.map(GoalRecordSummary::from),
            },
            output_schema: extraction_output_schema(),
        }
    }

    pub fn judge_request(judge_id: String, record: &GoalRecord) -> GoalJudgeRequestMessage {
        GoalJudgeRequestMessage {
            judge_id,
            instruction_version: GOAL_JUDGE_INSTRUCTION_VERSION.to_string(),
            fixed_instruction: GOAL_JUDGE_INSTRUCTION.to_string(),
            objective: record.contract.resolved_objective.clone(),
            criteria: record.contract.success_criteria.clone(),
            required_checks: record.contract.required_checks.clone(),
            constraints: record.contract.constraints.clone(),
            remaining_gaps: record.progress.remaining_gaps.clone(),
            output_schema: judge_output_schema(),
        }
    }

    pub fn render_extraction_message(message: &GoalExtractionRequestMessage) -> String {
        let mut out = String::new();
        let _ = writeln!(out, "{}", message.fixed_instruction);
        let _ = writeln!(out);
        let _ = writeln!(out, "RAW INPUT:\n{}", message.payload.raw_input.trim());
        let _ = writeln!(
            out,
            "\nENTRY: source={} hasGoalPrefix={}",
            message.payload.entry.source, message.payload.entry.has_goal_prefix
        );
        if let Some(active) = &message.payload.active_goal {
            let _ = writeln!(
                out,
                "\nACTIVE GOAL: id={} status={:?} objective={}",
                active.goal_id, active.status, active.objective
            );
        }
        let _ = writeln!(out, "\nextractionId={}", message.extraction_id);
        let _ = writeln!(out, "\nOUTPUT SCHEMA:\n{}", message.output_schema);
        out
    }

    /// The single judge message appended after the inherited transcript. It is
    /// deliberately small (goal facts + schema only): the conversation already
    /// contains the work, and the judge inspects the workspace on demand.
    pub fn render_judge_message(message: &GoalJudgeRequestMessage) -> String {
        let mut out = String::new();
        let _ = writeln!(out, "{}", message.fixed_instruction);
        let _ = writeln!(out, "\nGOAL OBJECTIVE:\n{}", message.objective.trim());

        if message.criteria.is_empty() {
            let _ = writeln!(out, "\nREQUIRED CRITERIA: (none specified)");
        } else {
            let _ = writeln!(out, "\nSUCCESS CRITERIA:");
            for criterion in &message.criteria {
                let _ = writeln!(
                    out,
                    "- [{}]{} {}",
                    criterion.id,
                    if criterion.required {
                        " (required)"
                    } else {
                        ""
                    },
                    criterion.description
                );
            }
        }

        if !message.required_checks.is_empty() {
            let _ = writeln!(out, "\nREQUIRED CHECKS:");
            for check in &message.required_checks {
                match &check.command {
                    Some(command) => {
                        let _ = writeln!(
                            out,
                            "- [{}] {} (run: `{}`)",
                            check.id, check.description, command
                        );
                    }
                    None => {
                        let _ = writeln!(out, "- [{}] {}", check.id, check.description);
                    }
                }
            }
        }

        if !message.constraints.is_empty() {
            let _ = writeln!(out, "\nCONSTRAINTS:");
            for constraint in &message.constraints {
                let _ = writeln!(out, "- {}", constraint);
            }
        }

        if !message.remaining_gaps.is_empty() {
            let _ = writeln!(
                out,
                "\nGAPS FROM THE PREVIOUS JUDGMENT (verify if resolved):"
            );
            for gap in &message.remaining_gaps {
                let _ = writeln!(out, "- {}", gap.description);
            }
        }

        let _ = writeln!(out, "\nOUTPUT SCHEMA:\n{}", message.output_schema);
        out
    }
}
