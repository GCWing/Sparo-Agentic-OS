//! Shared app platform primitives for Live App, Agent App, and Bridge App.

pub mod catalog;
pub mod manifest;
pub mod permissions;
pub mod surfaces;

pub use catalog::{AppCatalogEntry, AppCatalogKind};
pub use manifest::AppManifestIdentity;
pub use permissions::AppPermissionSummary;
pub use surfaces::AppSurfaces;
