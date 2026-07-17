//! Unified configuration service module
//!
//! A typed, transactional configuration management system.

pub mod agent_capability_config_canonicalizer;
pub mod app_language;
mod apply;
mod atomic_store;
pub mod catalog;
pub mod global;
pub mod manager;
mod policy;
mod secret_classification;
mod secret_store;
pub mod service;
pub mod transaction;
pub mod types;
mod validation;

pub use app_language::{get_app_language_code, short_model_user_language_instruction};
pub use apply::{
    external_config_apply_state, register_config_apply_adapter, ConfigApply,
    ConfigApplyAdapterCriticality, ConfigApplyAdapterRegistration, ConfigApplyContext,
    ConfigApplyFuture, ConfigApplyOrigin, ConfigApplyPathPattern, ConfigApplyPrepare,
    ConfigApplyPrepareContext, ConfigApplyPrepareFuture, ExternalConfigApplyState,
    ExternalConfigApplyStatus, CONFIG_APPLY_CONSUMER_AI_MODEL_RUNTIME,
    CONFIG_APPLY_CONSUMER_DEBUG_INGEST, CONFIG_APPLY_CONSUMER_HOST_AUTO_SCAN,
    CONFIG_APPLY_CONSUMER_INACTIVE_RUNTIME, CONFIG_APPLY_CONSUMER_RUNTIME_I18N,
    CONFIG_APPLY_CONSUMER_RUNTIME_LOGGING,
};
pub use catalog::{
    ConfigCatalog, PublishedConfigCatalog, PublishedSettingDescriptor, SettingAiDescriptor,
    SettingControl, SettingDescriptor, SettingDescriptorSource, SettingExposure, SettingMutability,
    SettingOptionDescriptor, SettingOptionsProvider, SettingPolicyDescriptor,
    SettingPresentationDescriptor, SettingRisk, SettingSensitivity, SettingStorageDescriptor,
};
pub use global::{
    get_global_config_service, initialize_global_config, initialize_global_config_with_settings,
    subscribe_config_commits, subscribe_config_rollbacks, ConfigApplyStatusReceiver,
    ConfigCommitReceiver, ConfigRollbackReceiver, GlobalConfigManager,
};
pub use manager::{
    ConfigManager, ConfigManagerSettings, ConfigStartupFailurePhase, ConfigStartupFailurePolicy,
    ConfigStartupIssue, ConfigStartupMode, ConfigStartupStatus, ConfigStatistics,
};
pub use service::{ConfigExport, ConfigHealthStatus, ConfigService};
pub use transaction::{
    config_plan_for_confirmation, config_plan_requires_confirmation, config_undo_for_confirmation,
    config_undo_requires_confirmation, CommitConfigPlanRequest, ConfigApplyReceipt,
    ConfigApplyReceiptStatus, ConfigCommit, ConfigCommitStatus, ConfigPatch, ConfigPatchOperation,
    ConfigPlan, ConfigPlanChange, ConfigPlanWarning, ConfigSnapshot, ConfigUndoConfirmation,
    PublishedConfigApplyReceipt, PublishedConfigCommit, PublishedConfigUndoConfirmation,
    RetryConfigApplyRequest, UndoConfigCommitRequest,
};
pub use types::*;

pub const PRIMARY_AI_MODEL_REQUIRED_REASON: &str = "Primary AI model is not configured";

/// A missing global service and a fresh zero-model configuration both mean AI
/// execution is not ready yet. Callers that schedule background work should
/// wait or skip without turning this normal setup state into an error.
pub async fn is_primary_ai_model_configured() -> bool {
    match get_global_config_service().await {
        Ok(service) => service.has_usable_ai_model(Some("primary")).await,
        Err(_) => false,
    }
}
