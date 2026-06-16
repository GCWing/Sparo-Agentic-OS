//! OSAgent - Agentic OS top-level work partner
use super::{Agent, RequestContextPolicy};
use crate::agentic::memory::store::MemoryScope;
use async_trait::async_trait;

pub struct OsAgent {
    default_tools: Vec<String>,
}

impl Default for OsAgent {
    fn default() -> Self {
        Self::new()
    }
}

impl OsAgent {
    pub fn new() -> Self {
        Self {
            default_tools: vec![
                // Agentic OS semantic control surface
                "Work".to_string(),
                "CapabilityRegistry".to_string(),
                "NativeOS".to_string(),
                "OSStatus".to_string(),
                // Clarification and local organization
                "AskUserQuestion".to_string(),
                "TodoWrite".to_string(),
                // Universal local inspection and execution substrate
                "LS".to_string(),
                "Read".to_string(),
                "Glob".to_string(),
                "Grep".to_string(),
                "Bash".to_string(),
                "ComputerUse".to_string(),
                // Web research
                "WebSearch".to_string(),
                "WebFetch".to_string(),
                // Reusable capability recipes
                "Skill".to_string(),
                // Durable memory
                "Memory".to_string(),
            ],
        }
    }
}

#[async_trait]
impl Agent for OsAgent {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        "OSAgent"
    }

    fn name(&self) -> &str {
        "OSAgent"
    }

    fn description(&self) -> &str {
        "Sparo Agentic OS top-level work partner: helps the user think, decide, organize, delegate, track, and close the loop with professional judgment and long-term continuity"
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "os_agent"
    }

    fn default_tools(&self) -> Vec<String> {
        self.default_tools.clone()
    }

    fn request_context_policy(&self) -> RequestContextPolicy {
        RequestContextPolicy::empty()
            .with_workspace_instructions()
            .with_workspace_routing_context()
            .with_host_overview_context()
            .with_memory_scope(MemoryScope::GlobalAgenticOs)
    }

    fn memory_scope(&self) -> MemoryScope {
        MemoryScope::GlobalAgenticOs
    }

    fn is_readonly(&self) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn os_agent_uses_work_tools_for_managed_work() {
        let tools = OsAgent::new().default_tools();
        assert!(tools.contains(&"Work".to_string()));
        assert!(tools.contains(&"CapabilityRegistry".to_string()));
        assert!(tools.contains(&"NativeOS".to_string()));
        assert!(tools.contains(&"OSStatus".to_string()));
        assert!(tools.contains(&"AskUserQuestion".to_string()));
        assert!(tools.contains(&"TodoWrite".to_string()));
        assert!(tools.contains(&"LS".to_string()));
        assert!(tools.contains(&"Bash".to_string()));
        assert!(tools.contains(&"ComputerUse".to_string()));
        assert!(tools.contains(&"Skill".to_string()));
        assert!(tools.contains(&"Memory".to_string()));
        assert!(!tools.contains(&"WorkRead".to_string()));
        assert!(!tools.contains(&"WorkStart".to_string()));
        assert!(!tools.contains(&"WorkAdvance".to_string()));
        assert!(!tools.contains(&"WorkControl".to_string()));
        assert!(!tools.contains(&"WorkMutation".to_string()));
        assert!(!tools.contains(&"AgentHandoff".to_string()));
        assert!(!tools.contains(&"SessionMessage".to_string()));
        assert!(!tools.contains(&"SessionHistory".to_string()));
        let unique_tools = tools.iter().collect::<std::collections::HashSet<_>>().len();
        assert_eq!(tools.len(), unique_tools);
    }

    #[test]
    fn os_agent_prompt_describes_work_first_execution() {
        let prompt = include_str!("prompts/os_agent.md");

        assert!(!prompt.contains("AgentHandoff"));
        assert!(prompt.contains("Work(action=\"start\")"));
        assert!(prompt.contains("Work(action=\"continue\")"));
        assert!(prompt.contains("Work(action=\"status\")"));
        assert!(!prompt.contains("AgentHandoff(action=\"handoff\")"));
        assert!(prompt.contains("through one `Work` tool"));
        assert!(prompt.contains("Always target Work by `work_id`"));
        assert!(prompt.contains("Never drive Work by a session id"));
        assert!(prompt.contains("give a result-oriented status"));
        assert!(prompt.contains("what the completion report will contain"));
        assert!(prompt.contains("Mention the WorkSession only when it helps"));
        assert!(!prompt.contains("WorkSession is open to watch"));
        assert!(!prompt.contains("Open the WorkSession to watch"));
        assert!(prompt.contains("Repository-backed engineering: codebase analysis"));
        assert!(prompt.contains("analyze a codebase"));
        assert!(prompt.contains("## Composing Multiple Work"));
        assert!(prompt.contains("Default to one Work"));
        assert!(prompt.contains("never just to split a plan"));
        assert!(prompt.contains("coordinate several top-level Works"));
        assert!(prompt.contains("**Sequence when dependent**"));
        assert!(prompt.contains("**Parallel when independent**"));
        assert!(prompt.contains("**You own the result**"));
        assert!(prompt.contains("into the next Work's `instructions`"));
        assert!(!prompt.contains("If the source material is code but the user wants an office-style artifact, route to `Cowork`"));
        // P0 regression: start must not claim a top-level session_id in its return shape.
        assert!(!prompt.contains("`work_id`, `session_id`, `execution_binding_id`"));
    }

    #[test]
    fn os_agent_prompt_has_silent_first_principles_loop() {
        let prompt = include_str!("prompts/os_agent.md");

        assert!(prompt.contains("# Internal First-Principles Reasoning Loop"));
        assert!(prompt.contains("reason silently from first principles"));
        assert!(prompt.contains("Do not reveal private chain-of-thought"));
    }

    #[test]
    fn os_agent_prompt_uses_sparo_as_user_facing_identity() {
        let prompt = include_str!("prompts/os_agent.md");

        assert!(prompt.contains("You are **Sparo**"));
        assert!(!prompt.contains("your user-facing identity is Sparo"));
        assert!(!prompt.contains("Internally, this Agent is implemented as `OSAgent`"));
        assert!(!prompt.contains("not the manager above Sparo OS"));
        assert!(!prompt.contains("narrow routing agent"));
        assert!(!prompt.contains("Do not introduce yourself as \"OSAgent\""));
        assert!(prompt.contains("Use **Sparo** as your user-facing name"));
    }

    #[test]
    fn os_agent_prompt_examples_are_user_facing() {
        let prompt = include_str!("prompts/os_agent.md");

        assert!(prompt.contains("# Interaction Examples"));
        assert!(prompt.contains("## Small Direct Task"));
        assert!(prompt.contains("## Missing Context Boundary"));
        assert!(prompt.contains("## Native OS Awareness"));
        assert!(prompt.contains("## Professional Output Quality"));
        assert!(prompt.contains("## Emotional But Actionable"));
        assert!(prompt.contains("## Completion Follow-up"));
        assert!(prompt.contains("Final deliverable: editable PPTX"));
        assert!(prompt.contains("Missing: audience level and style target"));
        assert!(prompt.contains("technical claims need repo evidence"));
        assert!(prompt.contains("Do not explain internal routing or Work mechanics"));
        assert!(prompt.contains("Prefer result-first language"));
        assert!(prompt.contains("Done: ..."));
        assert!(prompt.contains("Next: ..."));
        assert!(prompt.contains("Missing: ..."));
        assert!(prompt.contains("ProjectA login fix started"));
        assert!(prompt.contains("do not repeat raw tool results or inspection logs"));
        assert!(prompt.contains("answer with the result first"));
        assert!(prompt.contains("For execution and inspection tasks, lead with the result"));
        assert!(prompt.contains("C:\\Users\\you\\Downloads\\SparoSetup-1.4.2.msi"));
        assert!(prompt.contains("**Sparo**:"));
        assert!(!prompt.contains("Tool result:"));
        assert!(!prompt.contains("Good pattern:"));
        assert!(!prompt.contains("Bad pattern:"));
        assert!(!prompt.contains("Prefer this feel:"));
        assert!(!prompt.contains("Avoid this feel:"));
        assert!(!prompt.contains("product relationship issue"));
        assert!(!prompt.contains("prompt tweak"));
        assert!(!prompt.contains("assistant keeps warmth"));
        assert!(!prompt.contains("not because you are missing effort"));
        assert!(!prompt.contains("target is still fuzzy"));
        assert!(!prompt.contains("Let's stop editing line by line"));
        assert!(!prompt.contains("I'll put this into"));
        assert!(!prompt.contains("I'll pull out"));
        assert!(!prompt.contains("I would run"));
        assert!(!prompt.contains("I'll arrange"));
        assert!(!prompt.contains("I'll keep this tracked"));
        assert!(!prompt.contains("before I launch it"));
        assert!(!prompt.contains("I'll check Downloads"));
        assert!(!prompt.contains("**Executive Companion**:"));
    }
}
