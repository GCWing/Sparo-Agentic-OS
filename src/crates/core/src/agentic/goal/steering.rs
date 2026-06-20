use super::model::GoalRecord;

/// Stable system reminder injected into each owner continuation turn. The
/// turn-to-turn *instruction* comes from the judge's `next_steering`; this only
/// reminds the executor of the invariants (the loop owns completion).
pub struct GoalReminderBuilder;

impl GoalReminderBuilder {
    pub fn system_reminder(record: &GoalRecord) -> String {
        format!(
            "Active goal (id {}, revision {}):\n{}\n\nA judge automatically reviews the goal after every turn, so do not declare the goal complete in your final answer. Just do the next step well. Use Goal(action=\"blocked\") only if you are genuinely stuck.",
            record.goal_id, record.revision, record.contract.resolved_objective
        )
    }
}
