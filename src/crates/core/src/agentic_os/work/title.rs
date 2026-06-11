use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkTitleSource {
    User,
    Template,
    Session,
    LiveApp,
    Objective,
    Agent,
}

impl Default for WorkTitleSource {
    fn default() -> Self {
        Self::User
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkTitleState {
    #[serde(default)]
    pub source: WorkTitleSource,
    #[serde(default = "default_title_locked")]
    pub locked: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject_ref: Option<String>,
}

impl Default for WorkTitleState {
    fn default() -> Self {
        Self::user_locked()
    }
}

impl WorkTitleState {
    pub fn user_locked() -> Self {
        Self {
            source: WorkTitleSource::User,
            locked: true,
            subject_ref: None,
        }
    }

    pub fn template() -> Self {
        Self::unlocked(WorkTitleSource::Template, None)
    }

    pub fn session(session_id: impl Into<String>) -> Self {
        Self::unlocked(WorkTitleSource::Session, Some(session_id.into()))
    }

    pub fn live_app(app_id: impl Into<String>) -> Self {
        Self::unlocked(WorkTitleSource::LiveApp, Some(app_id.into()))
    }

    pub fn agent() -> Self {
        Self::unlocked(WorkTitleSource::Agent, None)
    }

    pub fn objective() -> Self {
        Self::unlocked(WorkTitleSource::Objective, None)
    }

    pub fn can_follow_session(&self, session_id: &str) -> bool {
        if self.locked
            || matches!(
                self.source,
                WorkTitleSource::User | WorkTitleSource::LiveApp
            )
        {
            return false;
        }

        self.subject_ref
            .as_deref()
            .map_or(true, |subject| subject == session_id)
    }

    pub fn can_follow_live_app(&self, app_id: &str) -> bool {
        !self.locked
            && self.source == WorkTitleSource::LiveApp
            && self
                .subject_ref
                .as_deref()
                .map_or(true, |subject| subject == app_id)
    }

    fn unlocked(source: WorkTitleSource, subject_ref: Option<String>) -> Self {
        Self {
            source,
            locked: false,
            subject_ref,
        }
    }
}

fn default_title_locked() -> bool {
    true
}
