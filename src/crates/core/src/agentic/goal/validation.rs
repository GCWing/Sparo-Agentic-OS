use super::model::*;
use crate::util::errors::{BitFunError, BitFunResult};

pub struct GoalValidationGate;

impl GoalValidationGate {
    pub fn validate_extraction(
        run: &GoalExtractionRun,
        result: &GoalExtractionResult,
    ) -> BitFunResult<()> {
        if result.extraction_id != run.extraction_id {
            return Err(BitFunError::validation("Extraction id mismatch"));
        }
        if result.parent_session_id != run.parent_session_id {
            return Err(BitFunError::validation(
                "Extraction parent session mismatch",
            ));
        }
        if result.trigger_turn_id != run.trigger_turn_id {
            return Err(BitFunError::validation("Extraction trigger turn mismatch"));
        }
        if result.confidence < 0.35 {
            return Err(BitFunError::validation("Extraction confidence is too low"));
        }

        match result.intent.kind {
            GoalIntentKind::CreateGoal
            | GoalIntentKind::UpdateGoal
            | GoalIntentKind::ApplyGuidance => {
                let contract = result
                    .contract
                    .as_ref()
                    .ok_or_else(|| BitFunError::validation("Goal contract is required"))?;
                if contract.resolved_objective.trim().is_empty() {
                    return Err(BitFunError::validation("Resolved objective is required"));
                }
                if contract.success_criteria.is_empty() {
                    return Err(BitFunError::validation(
                        "Contract must contain at least one success criterion",
                    ));
                }
                if contract
                    .success_criteria
                    .iter()
                    .any(|criterion| criterion.description.trim().is_empty())
                {
                    return Err(BitFunError::validation(
                        "Success criteria must have descriptions",
                    ));
                }
            }
            GoalIntentKind::ControlGoal => {
                if result.intent.control_action.is_none() {
                    return Err(BitFunError::validation(
                        "Control goal intent requires control action",
                    ));
                }
            }
            GoalIntentKind::AskClarification => {
                if result.intent.clarification_questions.is_empty() {
                    return Err(BitFunError::validation(
                        "Clarification intent requires at least one question",
                    ));
                }
            }
            GoalIntentKind::ChatOnly | GoalIntentKind::QueryGoal => {}
        }
        Ok(())
    }

    /// Deterministic consistency gate over a judge verdict. This is what keeps a
    /// drifting judge honest: a `pass` must actually mark every required
    /// criterion as met, and a non-terminal verdict must explain the closure
    /// gaps that keep the loop from stopping.
    pub fn validate_verdict(record: &GoalRecord, verdict: &GoalVerdict) -> BitFunResult<()> {
        if verdict.confidence < 0.3 {
            return Err(BitFunError::validation("Verdict confidence is too low"));
        }

        match verdict.state {
            GoalVerdictState::Pass => {
                if !verdict.remaining_gaps.is_empty() {
                    return Err(BitFunError::validation(
                        "Verdict claims pass but still lists remaining gaps",
                    ));
                }
                for criterion in record
                    .contract
                    .success_criteria
                    .iter()
                    .filter(|criterion| criterion.required)
                {
                    let met = verdict
                        .criteria
                        .iter()
                        .any(|result| result.id == criterion.id && result.met);
                    if !met {
                        return Err(BitFunError::validation(format!(
                            "Verdict claims pass but required criterion is not marked met: {}",
                            criterion.id
                        )));
                    }
                }
            }
            GoalVerdictState::Continue => {
                if verdict.remaining_gaps.is_empty() {
                    return Err(BitFunError::validation(
                        "Continue verdict must provide remaining gaps",
                    ));
                }
            }
            GoalVerdictState::NeedsUser => {
                let has_question = verdict
                    .user_question
                    .as_ref()
                    .map(|question| !question.trim().is_empty())
                    .unwrap_or(false);
                if !has_question {
                    return Err(BitFunError::validation(
                        "needs_user verdict must include a user question",
                    ));
                }
            }
            GoalVerdictState::Blocked => {
                if verdict.remaining_gaps.is_empty() {
                    return Err(BitFunError::validation(
                        "Blocked verdict must describe at least one remaining gap",
                    ));
                }
            }
        }
        Ok(())
    }
}
