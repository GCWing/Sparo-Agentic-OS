use crate::service::memory_store::MemoryScope;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestContextSection {
    WorkspaceInstructions,
    WorkspaceRoutingContext,
    MemoryFiles(MemoryScope),
    ProjectLayout,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestContextPolicy {
    pub sections: Vec<RequestContextSection>,
}

impl RequestContextPolicy {
    pub fn new(sections: Vec<RequestContextSection>) -> Self {
        let mut policy = Self::empty();
        for section in sections {
            policy = policy.with_section(section);
        }
        policy
    }

    pub fn empty() -> Self {
        Self {
            sections: Vec::new(),
        }
    }

    pub fn with_section(mut self, section: RequestContextSection) -> Self {
        if !self.sections.contains(&section) {
            self.sections.push(section);
        }
        self
    }

    pub fn with_workspace_instructions(self) -> Self {
        self.with_section(RequestContextSection::WorkspaceInstructions)
    }

    pub fn with_memory_scope(self, scope: MemoryScope) -> Self {
        self.with_section(RequestContextSection::MemoryFiles(scope))
    }

    pub fn with_workspace_routing_context(self) -> Self {
        self.with_section(RequestContextSection::WorkspaceRoutingContext)
    }

    pub fn with_project_layout(self) -> Self {
        self.with_section(RequestContextSection::ProjectLayout)
    }

    pub fn includes(&self, section: RequestContextSection) -> bool {
        self.sections.contains(&section)
    }

    pub fn memory_scopes(&self) -> Vec<MemoryScope> {
        self.sections
            .iter()
            .filter_map(|section| match section {
                RequestContextSection::MemoryFiles(scope) => Some(*scope),
                _ => None,
            })
            .collect()
    }
}

impl Default for RequestContextPolicy {
    fn default() -> Self {
        Self::empty()
            .with_workspace_instructions()
            .with_memory_scope(MemoryScope::WorkspaceProject)
            .with_project_layout()
    }
}

#[cfg(test)]
mod tests {
    use super::{RequestContextPolicy, RequestContextSection};
    use crate::service::memory_store::MemoryScope;

    #[test]
    fn default_policy_uses_workspace_memory_scope() {
        let policy = RequestContextPolicy::default();

        assert!(policy.includes(RequestContextSection::WorkspaceInstructions));
        assert!(policy.includes(RequestContextSection::ProjectLayout));
        assert_eq!(policy.memory_scopes(), vec![MemoryScope::WorkspaceProject]);
    }

    #[test]
    fn custom_policy_can_target_global_memory_scope() {
        let policy = RequestContextPolicy::empty().with_memory_scope(MemoryScope::GlobalAgenticOs);

        assert_eq!(policy.memory_scopes(), vec![MemoryScope::GlobalAgenticOs]);
    }

    #[test]
    fn with_section_deduplicates_entries() {
        let policy = RequestContextPolicy::empty()
            .with_workspace_instructions()
            .with_workspace_instructions()
            .with_workspace_routing_context()
            .with_workspace_routing_context()
            .with_memory_scope(MemoryScope::WorkspaceProject)
            .with_memory_scope(MemoryScope::WorkspaceProject);

        assert_eq!(
            policy.sections,
            vec![
                RequestContextSection::WorkspaceInstructions,
                RequestContextSection::WorkspaceRoutingContext,
                RequestContextSection::MemoryFiles(MemoryScope::WorkspaceProject),
            ]
        );
    }
}
