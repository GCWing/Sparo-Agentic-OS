//! Consent-gated Product App evolution state.
//!
//! Evolution never mutates an active release. It records minimized behavioral
//! signals and proposals that must eventually produce a normal Draft/Release.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::LazyLock;

use serde::{Deserialize, Serialize};
use tokio::fs;
use uuid::Uuid;

use crate::error::{CoreError, CoreResult};
use crate::infrastructure::PathManager;

use super::state_io::{atomic_write_json, recover_atomic_json};

const EVOLUTION_STATE_SCHEMA_VERSION: u32 = 1;
const DEFAULT_SIGNAL_RETENTION_DAYS: u32 = 30;
static EVOLUTION_STATE_LOCK: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EvolutionAutonomyLevel {
    Off,
    Suggest,
    Assisted,
    LimitedAutonomy,
}

impl Default for EvolutionAutonomyLevel {
    fn default() -> Self {
        Self::Off
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvolutionConsent {
    pub enabled: bool,
    pub autonomy_level: EvolutionAutonomyLevel,
    pub signal_retention_days: u32,
    pub allow_content_analysis: bool,
    pub allow_product_insights: bool,
    pub updated_at_ms: u64,
}

impl Default for EvolutionConsent {
    fn default() -> Self {
        Self {
            enabled: false,
            autonomy_level: EvolutionAutonomyLevel::Off,
            signal_retention_days: DEFAULT_SIGNAL_RETENTION_DAYS,
            allow_content_analysis: false,
            allow_product_insights: false,
            updated_at_ms: 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvolutionSignal {
    pub signal_id: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slot_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_id: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metrics: BTreeMap<String, f64>,
    pub occurred_at_ms: u64,
    pub expires_at_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EvolutionProposalKind {
    Create,
    Improve,
    Rebase,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EvolutionProposalStatus {
    Proposed,
    Drafting,
    Validating,
    AwaitingApproval,
    Shadowing,
    Canary,
    Active,
    Rejected,
    Failed,
    RolledBack,
    Archived,
}

impl EvolutionProposalStatus {
    fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Rejected | Self::Failed | Self::RolledBack | Self::Archived
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvolutionProposal {
    pub proposal_id: String,
    pub kind: EvolutionProposalKind,
    pub status: EvolutionProposalStatus,
    pub objective: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub evidence_signal_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_app_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_release_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidate_draft_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidate_release_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capability_delta: Vec<String>,
    pub risk_level: EvolutionRiskLevel,
    #[serde(default)]
    pub evaluation: EvolutionEvaluation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status_detail: Option<String>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EvolutionRiskLevel {
    #[default]
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvolutionEvaluation {
    pub passed: bool,
    pub non_inferior: bool,
    pub rollback_verified: bool,
    pub isolated_data_verified: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub checks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppEvolutionState {
    pub schema_version: u32,
    #[serde(default)]
    pub consent: EvolutionConsent,
    #[serde(default)]
    pub signals: BTreeMap<String, EvolutionSignal>,
    #[serde(default)]
    pub proposals: BTreeMap<String, EvolutionProposal>,
}

impl Default for ProductAppEvolutionState {
    fn default() -> Self {
        Self {
            schema_version: EVOLUTION_STATE_SCHEMA_VERSION,
            consent: EvolutionConsent::default(),
            signals: BTreeMap::new(),
            proposals: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ProductAppEvolutionStore {
    state_path: PathBuf,
}

impl ProductAppEvolutionStore {
    pub fn new(path_manager: &PathManager) -> Self {
        Self {
            state_path: path_manager
                .user_state_dir()
                .join("product_app_evolution.json"),
        }
    }

    /// Returns the persisted evolution ledger without mutating it.
    ///
    /// Retention is enforced only by trusted backend write/maintenance paths.
    /// A read must never become a client-controlled deletion operation.
    pub async fn state(&self) -> CoreResult<ProductAppEvolutionState> {
        let _guard = EVOLUTION_STATE_LOCK.lock().await;
        self.load().await
    }

    pub async fn set_consent(
        &self,
        mut consent: EvolutionConsent,
    ) -> CoreResult<ProductAppEvolutionState> {
        let _guard = EVOLUTION_STATE_LOCK.lock().await;
        validate_consent(&consent)?;
        let now_ms = trusted_now_ms();
        consent.updated_at_ms = now_ms;
        let mut state = self.load().await?;
        prune_expired_signals(&mut state, now_ms);
        if !consent.enabled {
            consent.autonomy_level = EvolutionAutonomyLevel::Off;
            consent.allow_content_analysis = false;
            consent.allow_product_insights = false;
            state.signals.clear();
            for proposal in state.proposals.values_mut() {
                if !proposal.status.is_terminal() {
                    proposal.status = EvolutionProposalStatus::Rejected;
                    proposal.status_detail = Some("Evolution consent was revoked.".to_string());
                    proposal.updated_at_ms = consent.updated_at_ms;
                    proposal.evidence_signal_ids.clear();
                }
            }
        } else if consent.autonomy_level == EvolutionAutonomyLevel::Off {
            return Err(CoreError::validation(
                "Enabled evolution consent requires a non-off autonomy level.",
            ));
        }
        state.consent = consent;
        self.save(&state).await?;
        Ok(state)
    }

    pub async fn record_signal(
        &self,
        kind: impl Into<String>,
        slot_id: Option<String>,
        app_id: Option<String>,
        release_id: Option<String>,
        metrics: BTreeMap<String, f64>,
    ) -> CoreResult<EvolutionSignal> {
        let _guard = EVOLUTION_STATE_LOCK.lock().await;
        let occurred_at_ms = trusted_now_ms();
        let mut state = self.load().await?;
        prune_expired_signals(&mut state, occurred_at_ms);
        if !state.consent.enabled {
            return Err(CoreError::validation(
                "Product App evolution is disabled. Explicit consent is required.",
            ));
        }
        let signal = build_signal(
            &state.consent,
            kind.into(),
            slot_id,
            app_id,
            release_id,
            metrics,
            occurred_at_ms,
        )?;
        state
            .signals
            .insert(signal.signal_id.clone(), signal.clone());
        self.save(&state).await?;
        Ok(signal)
    }

    /// Records a minimized signal when consent is active and otherwise does
    /// nothing. Runtime instrumentation uses this path so the default-off
    /// policy is a normal state, not an error path.
    pub async fn record_signal_if_consented(
        &self,
        kind: impl Into<String>,
        slot_id: Option<String>,
        app_id: Option<String>,
        release_id: Option<String>,
        metrics: BTreeMap<String, f64>,
    ) -> CoreResult<Option<EvolutionSignal>> {
        let _guard = EVOLUTION_STATE_LOCK.lock().await;
        let occurred_at_ms = trusted_now_ms();
        let mut state = self.load().await?;
        let pruned = prune_expired_signals(&mut state, occurred_at_ms);
        if !state.consent.enabled {
            if pruned {
                self.save(&state).await?;
            }
            return Ok(None);
        }
        let signal = build_signal(
            &state.consent,
            kind.into(),
            slot_id,
            app_id,
            release_id,
            metrics,
            occurred_at_ms,
        )?;
        state
            .signals
            .insert(signal.signal_id.clone(), signal.clone());
        self.save(&state).await?;
        Ok(Some(signal))
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create_proposal(
        &self,
        kind: EvolutionProposalKind,
        objective: impl Into<String>,
        evidence_signal_ids: Vec<String>,
        base_app_id: Option<String>,
        base_release_id: Option<String>,
        risk_level: EvolutionRiskLevel,
    ) -> CoreResult<EvolutionProposal> {
        let _guard = EVOLUTION_STATE_LOCK.lock().await;
        let now_ms = trusted_now_ms();
        let mut state = self.load().await?;
        prune_expired_signals(&mut state, now_ms);
        if !state.consent.enabled {
            return Err(CoreError::validation(
                "Product App evolution is disabled. Explicit consent is required.",
            ));
        }
        let objective = objective.into();
        if objective.trim().is_empty() {
            return Err(CoreError::validation(
                "Evolution proposal objective must not be empty.",
            ));
        }
        match kind {
            EvolutionProposalKind::Create => {
                if base_app_id.is_some() || base_release_id.is_some() {
                    return Err(CoreError::validation(
                        "Create evolution proposal must not declare a base App Release.",
                    ));
                }
            }
            EvolutionProposalKind::Improve | EvolutionProposalKind::Rebase => {
                let app_id = base_app_id.as_deref().ok_or_else(|| {
                    CoreError::validation("Improve and rebase proposals require baseAppId.")
                })?;
                let release_id = base_release_id.as_deref().ok_or_else(|| {
                    CoreError::validation("Improve and rebase proposals require baseReleaseId.")
                })?;
                validate_identifier("proposal.baseAppId", app_id)?;
                validate_identifier("proposal.baseReleaseId", release_id)?;
            }
        }
        for signal_id in &evidence_signal_ids {
            if !state.signals.contains_key(signal_id) {
                return Err(CoreError::validation(format!(
                    "Evolution proposal references unknown signal: {signal_id}"
                )));
            }
        }
        let proposal = EvolutionProposal {
            proposal_id: format!("proposal-{}", Uuid::new_v4()),
            kind,
            status: EvolutionProposalStatus::Proposed,
            objective,
            evidence_signal_ids,
            base_app_id,
            base_release_id,
            candidate_draft_id: None,
            candidate_release_id: None,
            capability_delta: Vec::new(),
            risk_level,
            evaluation: EvolutionEvaluation::default(),
            status_detail: None,
            created_at_ms: now_ms,
            updated_at_ms: now_ms,
        };
        state
            .proposals
            .insert(proposal.proposal_id.clone(), proposal.clone());
        self.save(&state).await?;
        Ok(proposal)
    }

    async fn update_proposal(
        &self,
        proposal_id: &str,
        next_status: EvolutionProposalStatus,
        candidate_draft_id: Option<String>,
        candidate_release_id: Option<String>,
        capability_delta: Vec<String>,
        evaluation: EvolutionEvaluation,
        status_detail: Option<String>,
    ) -> CoreResult<EvolutionProposal> {
        let _guard = EVOLUTION_STATE_LOCK.lock().await;
        let now_ms = trusted_now_ms();
        let mut state = self.load().await?;
        prune_expired_signals(&mut state, now_ms);
        let consent = state.consent.clone();
        let proposal = state.proposals.get_mut(proposal_id).ok_or_else(|| {
            CoreError::validation(format!("Evolution proposal not found: {proposal_id}"))
        })?;
        validate_transition(proposal.status, next_status)?;
        validate_activation_gate(
            &consent,
            proposal,
            next_status,
            &capability_delta,
            &evaluation,
        )?;

        proposal.status = next_status;
        if candidate_draft_id.is_some() {
            proposal.candidate_draft_id = candidate_draft_id;
        }
        if candidate_release_id.is_some() {
            proposal.candidate_release_id = candidate_release_id;
        }
        proposal.capability_delta = capability_delta;
        proposal.evaluation = evaluation;
        proposal.status_detail = status_detail;
        proposal.updated_at_ms = now_ms;
        let updated = proposal.clone();
        self.save(&state).await?;
        Ok(updated)
    }

    /// Accepts a user-reviewed proposal into the Drafting stage.
    ///
    /// The desktop boundary must first prove that `candidate_draft_id` resolves
    /// to a live Draft in the revision store. No client-selected status,
    /// evaluation, risk, capability delta, or candidate Release enters here.
    pub async fn approve_proposal_draft(
        &self,
        proposal_id: &str,
        candidate_draft_id: &str,
    ) -> CoreResult<EvolutionProposal> {
        validate_identifier("candidateDraftId", candidate_draft_id)?;
        self.update_proposal(
            proposal_id,
            EvolutionProposalStatus::Drafting,
            Some(candidate_draft_id.to_string()),
            None,
            Vec::new(),
            EvolutionEvaluation::default(),
            Some("User approved proposal for Draft implementation.".to_string()),
        )
        .await
    }

    pub async fn reject_proposal(&self, proposal_id: &str) -> CoreResult<EvolutionProposal> {
        let _guard = EVOLUTION_STATE_LOCK.lock().await;
        let now_ms = trusted_now_ms();
        let mut state = self.load().await?;
        prune_expired_signals(&mut state, now_ms);
        let proposal = state.proposals.get_mut(proposal_id).ok_or_else(|| {
            CoreError::validation(format!("Evolution proposal not found: {proposal_id}"))
        })?;
        validate_transition(proposal.status, EvolutionProposalStatus::Rejected)?;
        proposal.status = EvolutionProposalStatus::Rejected;
        proposal.status_detail = Some("User rejected proposal.".to_string());
        proposal.updated_at_ms = now_ms;
        let updated = proposal.clone();
        self.save(&state).await?;
        Ok(updated)
    }

    pub async fn rollback_proposal(&self, proposal_id: &str) -> CoreResult<EvolutionProposal> {
        let _guard = EVOLUTION_STATE_LOCK.lock().await;
        let now_ms = trusted_now_ms();
        let mut state = self.load().await?;
        prune_expired_signals(&mut state, now_ms);
        let proposal = state.proposals.get_mut(proposal_id).ok_or_else(|| {
            CoreError::validation(format!("Evolution proposal not found: {proposal_id}"))
        })?;
        validate_transition(proposal.status, EvolutionProposalStatus::RolledBack)?;
        proposal.status = EvolutionProposalStatus::RolledBack;
        proposal.status_detail = Some("User requested rollback.".to_string());
        proposal.updated_at_ms = now_ms;
        let updated = proposal.clone();
        self.save(&state).await?;
        Ok(updated)
    }

    pub async fn record_candidate_release(
        &self,
        draft_id: &str,
        release_id: &str,
    ) -> CoreResult<Vec<EvolutionProposal>> {
        validate_identifier("candidateDraftId", draft_id)?;
        validate_identifier("candidateReleaseId", release_id)?;
        let _guard = EVOLUTION_STATE_LOCK.lock().await;
        let now_ms = trusted_now_ms();
        let mut state = self.load().await?;
        let pruned = prune_expired_signals(&mut state, now_ms);
        let mut updated = Vec::new();
        for proposal in state.proposals.values_mut().filter(|proposal| {
            proposal.candidate_draft_id.as_deref() == Some(draft_id)
                && proposal.status == EvolutionProposalStatus::Drafting
        }) {
            proposal.candidate_release_id = Some(release_id.to_string());
            proposal.status = EvolutionProposalStatus::Validating;
            proposal.status_detail =
                Some("Candidate Release published; validation is required.".to_string());
            proposal.updated_at_ms = now_ms;
            updated.push(proposal.clone());
        }
        if pruned || !updated.is_empty() {
            self.save(&state).await?;
        }
        Ok(updated)
    }

    async fn load(&self) -> CoreResult<ProductAppEvolutionState> {
        recover_atomic_json(&self.state_path).await?;
        match fs::read(&self.state_path).await {
            Ok(bytes) => {
                let state: ProductAppEvolutionState = serde_json::from_slice(&bytes)?;
                if state.schema_version != EVOLUTION_STATE_SCHEMA_VERSION {
                    return Err(CoreError::validation(format!(
                        "Unsupported Product App evolution state schema: {}",
                        state.schema_version
                    )));
                }
                Ok(state)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(ProductAppEvolutionState::default())
            }
            Err(error) => Err(error.into()),
        }
    }

    async fn save(&self, state: &ProductAppEvolutionState) -> CoreResult<()> {
        atomic_write_json(&self.state_path, state).await
    }
}

fn build_signal(
    consent: &EvolutionConsent,
    kind: String,
    slot_id: Option<String>,
    app_id: Option<String>,
    release_id: Option<String>,
    metrics: BTreeMap<String, f64>,
    occurred_at_ms: u64,
) -> CoreResult<EvolutionSignal> {
    validate_identifier("signal.kind", &kind)?;
    if metrics.keys().any(|key| key.trim().is_empty()) {
        return Err(CoreError::validation(
            "Evolution signal metric names must not be empty.",
        ));
    }
    let retention_ms = u64::from(consent.signal_retention_days) * 24 * 60 * 60 * 1_000;
    Ok(EvolutionSignal {
        signal_id: format!("signal-{}", Uuid::new_v4()),
        kind,
        slot_id,
        app_id,
        release_id,
        metrics,
        occurred_at_ms,
        expires_at_ms: occurred_at_ms.saturating_add(retention_ms),
    })
}

fn validate_consent(consent: &EvolutionConsent) -> CoreResult<()> {
    if consent.signal_retention_days == 0 || consent.signal_retention_days > 365 {
        return Err(CoreError::validation(
            "Evolution signal retention must be between 1 and 365 days.",
        ));
    }
    Ok(())
}

fn validate_identifier(label: &str, value: &str) -> CoreResult<()> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || !trimmed
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(CoreError::validation(format!(
            "{label} must contain only ASCII letters, numbers, '-' or '_'."
        )));
    }
    Ok(())
}

fn trusted_now_ms() -> u64 {
    chrono::Utc::now().timestamp_millis().max(0) as u64
}

fn prune_expired_signals(state: &mut ProductAppEvolutionState, now_ms: u64) -> bool {
    let before = state.signals.len();
    state
        .signals
        .retain(|_, signal| signal.expires_at_ms > now_ms);
    let existing = state
        .signals
        .keys()
        .cloned()
        .collect::<std::collections::BTreeSet<_>>();
    for proposal in state.proposals.values_mut() {
        proposal
            .evidence_signal_ids
            .retain(|signal_id| existing.contains(signal_id));
    }
    before != state.signals.len()
}

fn validate_transition(
    current: EvolutionProposalStatus,
    next: EvolutionProposalStatus,
) -> CoreResult<()> {
    use EvolutionProposalStatus as Status;
    let allowed = match current {
        Status::Proposed => matches!(next, Status::Drafting | Status::Rejected | Status::Archived),
        Status::Drafting => matches!(next, Status::Validating | Status::Failed | Status::Rejected),
        Status::Validating => {
            matches!(
                next,
                Status::AwaitingApproval | Status::Failed | Status::Rejected
            )
        }
        Status::AwaitingApproval => {
            matches!(
                next,
                Status::Shadowing | Status::Rejected | Status::Archived
            )
        }
        Status::Shadowing => matches!(next, Status::Canary | Status::Failed | Status::Rejected),
        Status::Canary => matches!(next, Status::Active | Status::RolledBack | Status::Failed),
        Status::Active => matches!(next, Status::RolledBack | Status::Archived),
        Status::Rejected | Status::Failed | Status::RolledBack | Status::Archived => false,
    };
    if allowed {
        Ok(())
    } else {
        Err(CoreError::validation(format!(
            "Invalid evolution proposal transition: {current:?} -> {next:?}"
        )))
    }
}

fn validate_activation_gate(
    consent: &EvolutionConsent,
    proposal: &EvolutionProposal,
    next: EvolutionProposalStatus,
    capability_delta: &[String],
    evaluation: &EvolutionEvaluation,
) -> CoreResult<()> {
    if !matches!(
        next,
        EvolutionProposalStatus::Canary | EvolutionProposalStatus::Active
    ) {
        return Ok(());
    }
    if !consent.enabled {
        return Err(CoreError::validation(
            "Evolution consent is required before canary or activation.",
        ));
    }
    if proposal.candidate_release_id.is_none() {
        return Err(CoreError::validation(
            "Evolution proposal requires an immutable candidate Release before canary or activation.",
        ));
    }
    if consent.autonomy_level != EvolutionAutonomyLevel::LimitedAutonomy {
        return Err(CoreError::validation(
            "Canary and automatic activation require explicit limited-autonomy consent.",
        ));
    }
    if !capability_delta.is_empty() {
        return Err(CoreError::validation(
            "Capability changes require explicit approval outside automatic evolution.",
        ));
    }
    if proposal.risk_level != EvolutionRiskLevel::Low {
        return Err(CoreError::validation(
            "Only low-risk evolution proposals may enter canary or activation.",
        ));
    }
    if !evaluation.passed
        || !evaluation.non_inferior
        || !evaluation.rollback_verified
        || !evaluation.isolated_data_verified
    {
        return Err(CoreError::validation(
            "Evolution evaluation must pass correctness, non-inferiority, rollback, and isolated-data gates.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_store() -> (tempfile::TempDir, ProductAppEvolutionStore) {
        let temp = tempfile::tempdir().expect("temp dir");
        let state_path = temp.path().join("state").join("evolution.json");
        (temp, ProductAppEvolutionStore { state_path })
    }

    fn enabled_consent() -> EvolutionConsent {
        EvolutionConsent {
            enabled: true,
            autonomy_level: EvolutionAutonomyLevel::Assisted,
            signal_retention_days: 30,
            ..EvolutionConsent::default()
        }
    }

    #[tokio::test]
    async fn evolution_is_off_until_explicitly_enabled() {
        let (_temp, store) = test_store();
        let error = store
            .record_signal("retry", None, None, None, BTreeMap::new())
            .await
            .expect_err("signal must require consent");
        assert!(error.to_string().contains("Explicit consent"));
    }

    #[tokio::test]
    async fn revoking_consent_clears_signals_and_rejects_pending_proposals() {
        let (_temp, store) = test_store();
        store
            .set_consent(enabled_consent())
            .await
            .expect("enable consent");
        let signal = store
            .record_signal("retry", None, None, None, BTreeMap::new())
            .await
            .expect("record signal");
        let proposal = store
            .create_proposal(
                EvolutionProposalKind::Improve,
                "Reduce repeated retries",
                vec![signal.signal_id],
                Some("app".to_string()),
                Some("release".to_string()),
                EvolutionRiskLevel::Low,
            )
            .await
            .expect("create proposal");

        let disabled = EvolutionConsent {
            enabled: false,
            autonomy_level: EvolutionAutonomyLevel::Assisted,
            signal_retention_days: 30,
            updated_at_ms: 4,
            ..EvolutionConsent::default()
        };
        let state = store.set_consent(disabled).await.expect("revoke consent");

        assert!(state.signals.is_empty());
        assert_eq!(
            state.proposals[&proposal.proposal_id].status,
            EvolutionProposalStatus::Rejected
        );
        assert_eq!(state.consent.autonomy_level, EvolutionAutonomyLevel::Off);
    }

    #[tokio::test]
    async fn canary_requires_low_risk_evaluated_candidate_without_capability_delta() {
        let (_temp, store) = test_store();
        let mut consent = enabled_consent();
        consent.autonomy_level = EvolutionAutonomyLevel::LimitedAutonomy;
        store.set_consent(consent).await.expect("enable consent");
        let proposal = store
            .create_proposal(
                EvolutionProposalKind::Create,
                "Create a focused app",
                Vec::new(),
                None,
                None,
                EvolutionRiskLevel::Low,
            )
            .await
            .expect("create proposal");
        store
            .update_proposal(
                &proposal.proposal_id,
                EvolutionProposalStatus::Drafting,
                Some("draft".to_string()),
                None,
                Vec::new(),
                EvolutionEvaluation::default(),
                None,
            )
            .await
            .expect("draft");
        store
            .update_proposal(
                &proposal.proposal_id,
                EvolutionProposalStatus::Validating,
                None,
                Some("release".to_string()),
                Vec::new(),
                EvolutionEvaluation::default(),
                None,
            )
            .await
            .expect("validate");
        store
            .update_proposal(
                &proposal.proposal_id,
                EvolutionProposalStatus::AwaitingApproval,
                None,
                None,
                Vec::new(),
                EvolutionEvaluation::default(),
                None,
            )
            .await
            .expect("await approval");
        store
            .update_proposal(
                &proposal.proposal_id,
                EvolutionProposalStatus::Shadowing,
                None,
                None,
                Vec::new(),
                EvolutionEvaluation::default(),
                None,
            )
            .await
            .expect("shadow");

        let error = store
            .update_proposal(
                &proposal.proposal_id,
                EvolutionProposalStatus::Canary,
                None,
                None,
                vec!["network".to_string()],
                EvolutionEvaluation::default(),
                None,
            )
            .await
            .expect_err("unsafe canary must fail");
        assert!(error.to_string().contains("Capability changes"));
    }

    #[tokio::test]
    async fn state_read_is_pure_and_does_not_prune_expired_signals() {
        let (_temp, store) = test_store();
        let mut state = ProductAppEvolutionState::default();
        state.signals.insert(
            "signal-expired".to_string(),
            EvolutionSignal {
                signal_id: "signal-expired".to_string(),
                kind: "retry".to_string(),
                slot_id: None,
                app_id: None,
                release_id: None,
                metrics: BTreeMap::new(),
                occurred_at_ms: 0,
                expires_at_ms: 1,
            },
        );
        store.save(&state).await.expect("seed state");

        let loaded = store.state().await.expect("read state");

        assert!(loaded.signals.contains_key("signal-expired"));
        assert!(store
            .state()
            .await
            .expect("read persisted state")
            .signals
            .contains_key("signal-expired"));
    }

    #[tokio::test]
    async fn trusted_write_prunes_expired_signals_and_ignores_caller_timestamp() {
        let (_temp, store) = test_store();
        let mut state = ProductAppEvolutionState::default();
        state.consent = enabled_consent();
        state.signals.insert(
            "signal-expired".to_string(),
            EvolutionSignal {
                signal_id: "signal-expired".to_string(),
                kind: "retry".to_string(),
                slot_id: None,
                app_id: None,
                release_id: None,
                metrics: BTreeMap::new(),
                occurred_at_ms: 0,
                expires_at_ms: 1,
            },
        );
        store.save(&state).await.expect("seed state");

        let mut consent = enabled_consent();
        consent.updated_at_ms = u64::MAX;
        let updated = store.set_consent(consent).await.expect("trusted write");

        assert!(updated.signals.is_empty());
        assert_ne!(updated.consent.updated_at_ms, u64::MAX);
        assert!(updated.consent.updated_at_ms > 0);
    }

    #[test]
    fn canary_gate_requires_release_and_limited_autonomy() {
        let mut consent = enabled_consent();
        consent.autonomy_level = EvolutionAutonomyLevel::LimitedAutonomy;
        let mut proposal = EvolutionProposal {
            proposal_id: "proposal-test".to_string(),
            kind: EvolutionProposalKind::Create,
            status: EvolutionProposalStatus::Shadowing,
            objective: "Test candidate".to_string(),
            evidence_signal_ids: Vec::new(),
            base_app_id: None,
            base_release_id: None,
            candidate_draft_id: Some("draft-test".to_string()),
            candidate_release_id: None,
            capability_delta: Vec::new(),
            risk_level: EvolutionRiskLevel::Low,
            evaluation: EvolutionEvaluation::default(),
            status_detail: None,
            created_at_ms: 1,
            updated_at_ms: 1,
        };
        let passed = EvolutionEvaluation {
            passed: true,
            non_inferior: true,
            rollback_verified: true,
            isolated_data_verified: true,
            checks: Vec::new(),
        };

        let missing_release = validate_activation_gate(
            &consent,
            &proposal,
            EvolutionProposalStatus::Canary,
            &[],
            &passed,
        )
        .expect_err("Draft alone must not enter canary");
        assert!(missing_release
            .to_string()
            .contains("immutable candidate Release"));

        proposal.candidate_release_id = Some("release-test".to_string());
        consent.autonomy_level = EvolutionAutonomyLevel::Assisted;
        let insufficient_autonomy = validate_activation_gate(
            &consent,
            &proposal,
            EvolutionProposalStatus::Canary,
            &[],
            &passed,
        )
        .expect_err("Assisted consent must not enter canary automatically");
        assert!(insufficient_autonomy
            .to_string()
            .contains("limited-autonomy"));
    }
}
