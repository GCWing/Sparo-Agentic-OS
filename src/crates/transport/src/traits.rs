use async_trait::async_trait;
use sparo_events::AgenticEvent;
use std::fmt::Debug;

/// Host transport boundary used by product surfaces.
///
/// Agentic events stay typed until they reach the host adapter. Other backend
/// notifications use the generic event channel exposed through `EventEmitter`.
#[async_trait]
pub trait TransportAdapter: Send + Sync + Debug {
    /// Emit a typed agentic event to the host surface.
    async fn emit_event(&self, session_id: &str, event: AgenticEvent) -> anyhow::Result<()>;

    /// Emit a generic backend notification.
    async fn emit_generic(
        &self,
        event_name: &str,
        payload: serde_json::Value,
    ) -> anyhow::Result<()>;

    /// Return a stable adapter name for diagnostics.
    fn adapter_type(&self) -> &str;
}
