pub mod assignment;
pub mod execution_binding;
pub mod ids;
pub mod lifecycle;
pub mod projection;
pub mod record;
pub mod runtime_bridge;
pub mod service;
pub mod store;
pub mod subscriber;
pub mod surface;
pub mod title;
pub mod types;

pub use assignment::{WorkAssignmentKind, WorkAssignmentRef};
pub use execution_binding::{
    WorkExecutionBinding, WorkExecutionBindingStatus, WorkExecutionSource,
};
pub use ids::WorkId;
pub use lifecycle::{WorkLifecycle, WorkLifecycleEvent, WorkSummary};
pub use projection::WorkProjection;
pub use record::{AgentSessionRef, ArtifactRef, MemoryRef, WorkRecord};
pub use runtime_bridge::{
    AgenticWorkRuntimeBridge, CreateWorkSessionOutcome, CreateWorkSessionRequest,
    NoopWorkRuntimeBridge, WorkRuntimeBridge, WorkSessionAdvanceOutcome, WorkSessionAdvanceRequest,
};
pub use service::{
    AdvanceWorkRequest, AdvanceWorkResponse, ControlWorkAction, ControlWorkRequest,
    ControlWorkResponse, CreateWorkRequest, DispatchNewWorkRequest, DispatchWorkRequest,
    DispatchWorkResponse, PrimarySurfacePolicy, StartWorkRequest, StartWorkResponse,
    UpdateWorkRequest, WorkService,
};
pub use store::{default_work_store, FileWorkStore, MemoryWorkStore, WorkStore};
pub use subscriber::WorkEventSubscriber;
pub use surface::WorkSurfaceRef;
pub use title::{WorkTitleSource, WorkTitleState};
pub use types::{WorkKind, WorkScope, WorkStatus, WorkVisibility};
