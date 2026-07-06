use super::{Agent, RequestContextPolicy};
use async_trait::async_trait;

pub struct OutcomeReviewAgent {
    default_tools: Vec<String>,
}

impl Default for OutcomeReviewAgent {
    fn default() -> Self {
        Self::new()
    }
}

impl OutcomeReviewAgent {
    pub fn new() -> Self {
        Self {
            default_tools: vec![
                "SessionHistory".to_string(),
                "Read".to_string(),
                "Grep".to_string(),
                "Glob".to_string(),
                "LS".to_string(),
                "GetFileDiff".to_string(),
                "WebSearch".to_string(),
                "WebFetch".to_string(),
                "submit_outcome_review".to_string(),
            ],
        }
    }
}

#[async_trait]
impl Agent for OutcomeReviewAgent {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        "OutcomeReview"
    }

    fn name(&self) -> &str {
        "Outcome Review"
    }

    fn description(&self) -> &str {
        r#"Read-only outcome reviewer for OSAgent-managed Work. Use after a Work returns when final result quality matters: code changes, user-visible deliverables, data or research claims, automation side effects, multi-Work synthesis, or any result that needs evidence-based acceptance before user handoff. Judges the final effect, not the execution transcript, and returns a structured verdict for OSAgent."#
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "outcome_review"
    }

    fn default_tools(&self) -> Vec<String> {
        self.default_tools.clone()
    }

    fn request_context_policy(&self) -> RequestContextPolicy {
        RequestContextPolicy::workspace_agent_default().with_files_context()
    }

    fn is_readonly(&self) -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::{Agent, OutcomeReviewAgent};

    #[test]
    fn has_expected_readonly_tools() {
        let agent = OutcomeReviewAgent::new();
        assert_eq!(
            agent.default_tools(),
            vec![
                "SessionHistory".to_string(),
                "Read".to_string(),
                "Grep".to_string(),
                "Glob".to_string(),
                "LS".to_string(),
                "GetFileDiff".to_string(),
                "WebSearch".to_string(),
                "WebFetch".to_string(),
                "submit_outcome_review".to_string(),
            ]
        );
    }

    #[test]
    fn always_uses_default_prompt_template() {
        let agent = OutcomeReviewAgent::new();
        assert_eq!(
            agent.prompt_template_name(Some("gpt-5.1")),
            "outcome_review"
        );
        assert_eq!(agent.prompt_template_name(None), "outcome_review");
    }

    #[test]
    fn is_readonly_for_safe_result_review() {
        let agent = OutcomeReviewAgent::new();
        assert!(agent.is_readonly());
    }
}
