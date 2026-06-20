use super::model::{GoalEntryMetadata, GoalUserRequest};

#[derive(Debug, Clone)]
pub struct GoalTextIntake {
    pub session_id: String,
    pub workspace_path: String,
    pub agent_type: Option<String>,
    pub trigger_turn_id: String,
    pub raw_input: String,
    pub skip_initial_continuation: bool,
    pub entry: GoalEntryMetadata,
}

pub struct TextIntakeAnnotator;

impl TextIntakeAnnotator {
    pub fn annotate(request: GoalUserRequest) -> GoalTextIntake {
        let raw_input = request.raw_input;
        let trimmed = raw_input.trim_start();
        let has_goal_prefix = trimmed
            .get(..5)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("/goal"));
        let prefix = has_goal_prefix.then(|| "/goal".to_string());
        GoalTextIntake {
            session_id: request.session_id,
            workspace_path: request.workspace_path,
            agent_type: request.agent_type,
            trigger_turn_id: request
                .turn_id
                .unwrap_or_else(|| format!("goal-intake-{}", uuid::Uuid::new_v4())),
            skip_initial_continuation: request.skip_initial_continuation,
            raw_input,
            entry: GoalEntryMetadata {
                source: "desktop_text".to_string(),
                has_goal_prefix,
                prefix,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn annotator_records_affordance_without_intent() {
        let intake = TextIntakeAnnotator::annotate(GoalUserRequest {
            session_id: "s".to_string(),
            workspace_path: "w".to_string(),
            agent_type: None,
            turn_id: Some("t".to_string()),
            skip_initial_continuation: false,
            raw_input: "/goal pause".to_string(),
        });

        assert!(intake.entry.has_goal_prefix);
        assert_eq!(intake.raw_input, "/goal pause");
        assert_eq!(intake.trigger_turn_id, "t");
    }
}
