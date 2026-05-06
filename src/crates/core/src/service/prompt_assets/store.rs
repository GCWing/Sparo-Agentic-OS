use super::format::{
    ensure_safe_relative_path, is_prompt_file, parse_prompt_asset, prompt_file_name,
    serialize_prompt_asset, validate_asset, validate_prompt_content,
};
use super::types::{
    PromptAsset, PromptAssetMetadata, PromptAssetScope, PromptAssetSummary, PromptValidationReport,
};
use crate::infrastructure::get_path_manager_arc;
use crate::util::errors::{BitFunError, BitFunResult};
use std::fs;
use std::path::{Path, PathBuf};

const PROMPT_STORE_DIR: &str = "prompts";
const DEFAULT_PROMPT_SUBDIR: &str = "templates";

pub struct PromptAssetStore;

impl PromptAssetStore {
    pub fn user_prompt_root() -> PathBuf {
        get_path_manager_arc()
            .sparo_home_dir()
            .join(PROMPT_STORE_DIR)
    }

    pub fn workspace_prompt_root(workspace_root: &Path) -> PathBuf {
        get_path_manager_arc()
            .project_runtime_root(workspace_root)
            .join(PROMPT_STORE_DIR)
    }

    pub fn project_prompt_root(workspace_root: &Path) -> PathBuf {
        get_path_manager_arc()
            .project_root(workspace_root)
            .join(PROMPT_STORE_DIR)
    }

    pub fn scoped_prompt_root(scope: PromptAssetScope, workspace_root: &Path) -> PathBuf {
        match scope {
            PromptAssetScope::User => Self::user_prompt_root(),
            PromptAssetScope::Workspace => Self::workspace_prompt_root(workspace_root),
            PromptAssetScope::Project => Self::project_prompt_root(workspace_root),
        }
    }

    pub fn list_assets(
        workspace_root: &Path,
        scope: PromptAssetScope,
    ) -> BitFunResult<Vec<PromptAssetSummary>> {
        let root = Self::scoped_prompt_root(scope, workspace_root);
        if !root.exists() {
            return Ok(Vec::new());
        }
        let mut assets = Vec::new();
        for path in collect_prompt_files(&root)? {
            match Self::read_asset_from_path(&root, &path) {
                Ok(asset) => assets.push(PromptAssetSummary::from(&asset)),
                Err(error) => log::warn!(
                    "Failed to load prompt asset: workspace_path={} path={} error={}",
                    workspace_root.display(),
                    path.display(),
                    error
                ),
            }
        }
        assets.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(assets)
    }

    pub fn get_asset(
        workspace_root: &Path,
        scope: PromptAssetScope,
        asset_id: &str,
    ) -> BitFunResult<PromptAsset> {
        let root = Self::scoped_prompt_root(scope, workspace_root);
        for path in collect_prompt_files(&root)? {
            let asset = Self::read_asset_from_path(&root, &path)?;
            if asset.metadata.id == asset_id {
                return Ok(asset);
            }
        }
        Err(BitFunError::NotFound(format!(
            "Prompt asset not found: {asset_id}"
        )))
    }

    pub fn save_asset(
        workspace_root: &Path,
        scope: PromptAssetScope,
        mut metadata: PromptAssetMetadata,
        body: &str,
        relative_path: Option<&str>,
    ) -> BitFunResult<PromptAsset> {
        metadata.scope = scope;
        let content = serialize_prompt_asset(&metadata, body)?;
        let report = validate_prompt_content(&content);
        if !report.valid {
            return Err(BitFunError::validation("Prompt asset is invalid"));
        }
        let root = Self::scoped_prompt_root(scope, workspace_root);
        let relative = if let Some(relative_path) = relative_path {
            ensure_safe_relative_path(relative_path)?
        } else {
            PathBuf::from(DEFAULT_PROMPT_SUBDIR).join(prompt_file_name(&metadata.id))
        };
        let path = root.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&path, content)?;
        Self::read_asset_from_path(&root, &path)
    }

    pub fn validate_content(content: &str) -> PromptValidationReport {
        validate_prompt_content(content)
    }

    pub fn validate_asset(
        workspace_root: &Path,
        scope: PromptAssetScope,
        asset_id: &str,
    ) -> BitFunResult<PromptValidationReport> {
        let asset = Self::get_asset(workspace_root, scope, asset_id)?;
        Ok(validate_asset(&asset))
    }

    pub fn project_prompt_root_relative_path() -> &'static str {
        ".sparo_os/prompts"
    }

    fn read_asset_from_path(root: &Path, path: &Path) -> BitFunResult<PromptAsset> {
        let content = fs::read_to_string(path)?;
        parse_prompt_asset(path, root, &content)
    }
}

fn collect_prompt_files(root: &Path) -> BitFunResult<Vec<PathBuf>> {
    let mut files = Vec::new();
    if !root.exists() {
        return Ok(files);
    }
    collect_prompt_files_recursive(root, &mut files)?;
    Ok(files)
}

fn collect_prompt_files_recursive(dir: &Path, files: &mut Vec<PathBuf>) -> BitFunResult<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_prompt_files_recursive(&path, files)?;
        } else if is_prompt_file(&path) {
            files.push(path);
        }
    }
    Ok(())
}
