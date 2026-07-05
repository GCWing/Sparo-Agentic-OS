use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::permissions::AppPermissionSummary;
use super::{
    AppIconSpec, AppInteractionModel, AppSurfaceMode, AppTruthSource, AppWorkMultiplicity,
    NativeAppManagementAction, NativeAppManagementPolicy, ProductAppLaunch, ProductAppLaunchKind,
    ProductAppLaunchScopeRequirement, WorkObjectKind,
};

pub const NATIVE_SYSTEM_APP_IDS: &[&str] = &["prime-builder", "cowork", "design", "app-studio"];
pub const RETIRED_NATIVE_PRODUCT_APP_IDS: &[&str] = &[
    "builtin-coding",
    "builtin-cowork",
    "builtin-design",
    "builtin-app-studio",
    "builtin-component-studio",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NativeAppOrigin {
    NativeSystem,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NativeAppAvailability {
    AlwaysAvailable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAppCatalogEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub goal: String,
    pub interaction_model: AppInteractionModel,
    #[serde(default)]
    pub work_multiplicity: AppWorkMultiplicity,
    #[serde(default)]
    pub work_object_kinds: Vec<WorkObjectKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub truth_source: Option<AppTruthSource>,
    pub primary_surface_mode: AppSurfaceMode,
    pub permissions: AppPermissionSummary,
    pub icon: AppIconSpec,
    pub category: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    pub launch: ProductAppLaunch,
    pub origin: NativeAppOrigin,
    pub availability: NativeAppAvailability,
    pub management: NativeAppManagementPolicy,
}

pub fn is_native_system_app_id(app_id: &str) -> bool {
    NATIVE_SYSTEM_APP_IDS.contains(&app_id)
}

pub fn is_retired_native_product_app_id(app_id: &str) -> bool {
    RETIRED_NATIVE_PRODUCT_APP_IDS.contains(&app_id)
}

pub fn is_native_system_lifecycle_id(app_id: &str) -> bool {
    is_native_system_app_id(app_id) || is_retired_native_product_app_id(app_id)
}

pub fn native_app_catalog() -> Vec<NativeAppCatalogEntry> {
    native_app_catalog_with_icon_payload(true)
}

pub fn native_app_shell_catalog() -> Vec<NativeAppCatalogEntry> {
    native_app_catalog_with_icon_payload(false)
}

fn native_app_catalog_with_icon_payload(include_icon_payload: bool) -> Vec<NativeAppCatalogEntry> {
    vec![
        native_agent_app(
            "prime-builder",
            "BitFun Coder",
            "Native default execution workspace for flexible implementation, debugging, automation, and verification.",
            "Take a goal, choose the next action, execute, verify, and hand off the result.",
            native_app_icon("prime-builder", include_icon_payload),
            "developer",
            "agentic",
            "agentic",
            vec!["native", "coding", "development"],
        ),
        native_agent_app(
            "cowork",
            "Cowork",
            "Native collaboration workspace for documents, drafting, and structured multi-step work.",
            "Clarify, plan, draft, revise, and package collaborative work with practical artifacts.",
            native_app_icon("cowork", include_icon_payload),
            "productivity",
            "Cowork",
            "Cowork",
            vec!["native", "documents", "collaboration"],
        ),
        native_agent_app(
            "design",
            "Design",
            "Native design workspace for artifacts, prototypes, and visual systems.",
            "Create and refine design artifacts, prototypes, and visual systems from a user brief.",
            native_app_icon("design", include_icon_payload),
            "creative",
            "Design",
            "Design",
            vec!["native", "design", "prototype"],
        ),
        NativeAppCatalogEntry {
            id: "app-studio".to_string(),
            name: "App Studio".to_string(),
            description:
                "Native Product App creation and maintenance studio for package-first app design."
                    .to_string(),
            goal: "Create, inspect, and evolve Product App packages and their component graph."
                .to_string(),
            interaction_model: AppInteractionModel::Conversation,
            work_multiplicity: AppWorkMultiplicity::Multiple,
            work_object_kinds: Vec::new(),
            truth_source: None,
            primary_surface_mode: AppSurfaceMode::ChatPrimary,
            permissions: AppPermissionSummary {
                fs: true,
                shell: true,
                ai: true,
                ..AppPermissionSummary::default()
            },
            icon: native_app_icon("app-studio", include_icon_payload),
            category: "developer".to_string(),
            tags: vec![
                "native".to_string(),
                "studio".to_string(),
                "product-app".to_string(),
            ],
            launch: ProductAppLaunch {
                kind: ProductAppLaunchKind::AppStudio,
                target_id: "AppStudio".to_string(),
                scope_requirement: ProductAppLaunchScopeRequirement::SystemAllowed,
                agent_type: Some("AppStudio".to_string()),
                surface_id: None,
            },
            origin: NativeAppOrigin::NativeSystem,
            availability: NativeAppAvailability::AlwaysAvailable,
            management: native_system_management_policy(),
        },
    ]
}

fn native_agent_app(
    id: &str,
    name: &str,
    description: &str,
    goal: &str,
    icon: AppIconSpec,
    category: &str,
    target_id: &str,
    agent_type: &str,
    tags: Vec<&str>,
) -> NativeAppCatalogEntry {
    NativeAppCatalogEntry {
        id: id.to_string(),
        name: name.to_string(),
        description: description.to_string(),
        goal: goal.to_string(),
        interaction_model: AppInteractionModel::Conversation,
        work_multiplicity: AppWorkMultiplicity::Multiple,
        work_object_kinds: Vec::new(),
        truth_source: None,
        primary_surface_mode: AppSurfaceMode::ChatPrimary,
        permissions: AppPermissionSummary {
            fs: true,
            shell: true,
            ai: true,
            ..AppPermissionSummary::default()
        },
        icon,
        category: category.to_string(),
        tags: tags.into_iter().map(ToString::to_string).collect(),
        launch: ProductAppLaunch {
            kind: ProductAppLaunchKind::AgentSession,
            target_id: target_id.to_string(),
            scope_requirement: ProductAppLaunchScopeRequirement::WorkspaceOptional,
            agent_type: Some(agent_type.to_string()),
            surface_id: None,
        },
        origin: NativeAppOrigin::NativeSystem,
        availability: NativeAppAvailability::AlwaysAvailable,
        management: native_system_management_policy(),
    }
}

fn native_system_management_policy() -> NativeAppManagementPolicy {
    NativeAppManagementPolicy {
        actions: vec![
            NativeAppManagementAction::Configure,
            NativeAppManagementAction::ResetState,
            NativeAppManagementAction::HideFromHome,
        ],
        ..NativeAppManagementPolicy::default()
    }
}

fn native_app_icon(asset_id: &str, include_payload: bool) -> AppIconSpec {
    let mime_type = "image/png";

    if !include_payload {
        return AppIconSpec::NativeAsset {
            asset_id: asset_id.to_string(),
            mime_type: Some(mime_type.to_string()),
            digest: None,
            uri: None,
            background: None,
        };
    }

    let bytes = match asset_id {
        "prime-builder" => PRIME_BUILDER_ICON,
        "cowork" => COWORK_ICON,
        "design" => DESIGN_ICON,
        "app-studio" => APP_STUDIO_ICON,
        _ => PRIME_BUILDER_ICON,
    };
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = format!("sha256:{:x}", hasher.finalize());
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);

    AppIconSpec::NativeAsset {
        asset_id: asset_id.to_string(),
        mime_type: Some(mime_type.to_string()),
        digest: Some(digest),
        uri: Some(format!("data:{mime_type};base64,{encoded}")),
        background: None,
    }
}

const PRIME_BUILDER_ICON: &[u8] = include_bytes!("assets/native-app-icons/prime-builder-icon.png");
const COWORK_ICON: &[u8] = include_bytes!("assets/native-app-icons/cowork-icon.png");
const DESIGN_ICON: &[u8] = include_bytes!("assets/native-app-icons/design-icon.png");
const APP_STUDIO_ICON: &[u8] = include_bytes!("assets/native-app-icons/app-studio-icon.png");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_system_apps_are_always_available_without_lifecycle_actions() {
        let apps = native_app_catalog();

        for app in apps {
            assert_eq!(app.origin, NativeAppOrigin::NativeSystem);
            assert_eq!(app.availability, NativeAppAvailability::AlwaysAvailable);
            assert_eq!(
                app.management.origin,
                crate::app_platform::NativeAppManagementOrigin::NativeSystem
            );
        }
    }

    #[test]
    fn retired_native_product_app_ids_are_native_lifecycle_ids() {
        for app_id in RETIRED_NATIVE_PRODUCT_APP_IDS {
            assert!(is_native_system_lifecycle_id(app_id));
        }
        for app_id in NATIVE_SYSTEM_APP_IDS {
            assert!(is_native_system_lifecycle_id(app_id));
        }
    }
}
