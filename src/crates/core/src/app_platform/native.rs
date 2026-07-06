use std::collections::BTreeMap;

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::permissions::AppPermissionSummary;
use super::{
    AppAuthor, AppI18n, AppIconSpec, AppInteractionModel, AppLocalizedMetadata, AppSurfaceMode,
    AppTruthSource, AppWorkMultiplicity, NativeAppManagementAction, NativeAppManagementPolicy,
    ProductAppLaunch, ProductAppLaunchKind, ProductAppLaunchScopeRequirement, WorkObjectKind,
};

pub const NATIVE_SYSTEM_APP_IDS: &[&str] = &["runno", "app-builder"];
const HIDDEN_NATIVE_SYSTEM_LIFECYCLE_IDS: &[&str] = &["os-agent"];

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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub authors: Vec<AppAuthor>,
    #[serde(default, skip_serializing_if = "AppI18n::is_empty")]
    pub i18n: AppI18n,
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

pub fn is_native_system_lifecycle_id(app_id: &str) -> bool {
    is_native_system_app_id(app_id) || HIDDEN_NATIVE_SYSTEM_LIFECYCLE_IDS.contains(&app_id)
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
            "runno",
            "Runno",
            "Sparo OS's general execution unit: flexible, efficient, and strongly goal-oriented for handling all kinds of tasks.",
            app_i18n(&[
                (
                    "en-US",
                    "Runno",
                    "Sparo OS's general execution unit: flexible, efficient, and strongly goal-oriented for handling all kinds of tasks.",
                    &["os", "execution", "general"],
                ),
                (
                    "zh-CN",
                    "Runno",
                    "Sparo OS 的通用执行单元，灵活、高效、目标感强，适合处理各种类型任务。",
                    &["系统", "执行", "通用"],
                ),
            ]),
            native_app_icon("runno", include_icon_payload),
            "system",
            "Runno",
            "Runno",
            vec!["os", "execution", "general"],
        ),
        NativeAppCatalogEntry {
            id: "app-builder".to_string(),
            name: "App Builder".to_string(),
            description: "Build a personal intelligent app around your way of working by understanding your needs or existing apps, then recomposing features, workflows, and methods."
                .to_string(),
            authors: vec![sparo_os_author()],
            i18n: app_i18n(&[
                (
                    "en-US",
                    "App Builder",
                    "Build a personal intelligent app around your way of working by understanding your needs or existing apps, then recomposing features, workflows, and methods.",
                    &["app-builder", "intelligent-app", "reuse"],
                ),
                (
                    "zh-CN",
                    "App Builder",
                    "为你打造专属智能应用，理解需求或解析既有应用，重组功能、流程与方法，让应用更贴合你的工作方式。",
                    &["应用构建", "智能应用", "复用"],
                ),
            ]),
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
            icon: native_app_icon("app-builder", include_icon_payload),
            category: "developer".to_string(),
            tags: vec![
                "app-builder".to_string(),
                "intelligent-app".to_string(),
                "reuse".to_string(),
            ],
            launch: ProductAppLaunch {
                kind: ProductAppLaunchKind::AppBuilder,
                target_id: "AppBuilder".to_string(),
                scope_requirement: ProductAppLaunchScopeRequirement::SystemAllowed,
                agent_type: Some("AppBuilder".to_string()),
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
    i18n: AppI18n,
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
        authors: vec![sparo_os_author()],
        i18n,
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

fn sparo_os_author() -> AppAuthor {
    AppAuthor {
        name: "Sparo OS".to_string(),
        url: Some("https://gcwing.github.io/Sparo-Agentic-OS/".to_string()),
    }
}

fn app_i18n(entries: &[(&str, &str, &str, &[&str])]) -> AppI18n {
    let locales = entries
        .iter()
        .map(|(locale, name, description, tags)| {
            (
                (*locale).to_string(),
                AppLocalizedMetadata {
                    name: Some((*name).to_string()),
                    description: Some((*description).to_string()),
                    tags: tags.iter().map(|tag| (*tag).to_string()).collect(),
                },
            )
        })
        .collect::<BTreeMap<_, _>>();
    AppI18n { locales }
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
        "runno" => RUNNO_ICON,
        "app-builder" => APP_BUILDER_ICON,
        _ => RUNNO_ICON,
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

const RUNNO_ICON: &[u8] = include_bytes!("assets/native-app-icons/runno-icon.png");
const APP_BUILDER_ICON: &[u8] = include_bytes!("assets/native-app-icons/app-builder-icon.png");

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
    fn native_system_app_ids_are_native_lifecycle_ids() {
        for app_id in NATIVE_SYSTEM_APP_IDS {
            assert!(is_native_system_lifecycle_id(app_id));
        }
        for app_id in HIDDEN_NATIVE_SYSTEM_LIFECYCLE_IDS {
            assert!(is_native_system_lifecycle_id(app_id));
        }
        assert!(!native_app_catalog().iter().any(|app| app.id == "os-agent"));
    }
}
