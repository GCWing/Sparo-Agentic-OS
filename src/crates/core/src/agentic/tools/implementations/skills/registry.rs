//! Skill registry
//!
//! Manages skill discovery, mode-specific filtering, and loading.

use super::agent_overrides::{
    load_disabled_agent_skills_local, load_disabled_agent_skills_remote,
    load_user_agent_skill_overrides, UserAgentSkillOverrides,
};
use super::builtin::{
    builtin_skill_group_key, ensure_builtin_skills_installed, is_builtin_skill_dir_name,
};
use super::default_profiles::is_skill_enabled_for_agent;
use super::types::{SkillData, SkillInfo, SkillLocation};
use crate::agentic::workspace::WorkspaceFileSystem;
use crate::infrastructure::{get_path_manager_arc, APP_HIDDEN_DIR_NAME};
use crate::util::errors::{BitFunError, BitFunResult};
use log::{debug, error};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tokio::fs;
use tokio::sync::RwLock;

/// Global Skill registry instance
static SKILL_REGISTRY: OnceLock<SkillRegistry> = OnceLock::new();

const USER_PREFIX: &str = "user";
const PROJECT_PREFIX: &str = "project";

/// Project-level skill roots under a workspace.
const PROJECT_SKILL_SLOTS: &[(&str, &str, &str)] = &[
    (APP_HIDDEN_DIR_NAME, "skills", "sparo"),
    (".claude", "skills", "claude"),
    (".codex", "skills", "codex"),
    (".cursor", "skills", "cursor"),
    (".opencode", "skills", "opencode"),
    (".agents", "skills", "agents"),
];

/// Home-directory based user-level skill roots.
const USER_HOME_SKILL_SLOTS: &[(&str, &str, &str)] = &[
    (".claude", "skills", "home.claude"),
    (".codex", "skills", "home.codex"),
    (".cursor", "skills", "home.cursor"),
    (".agents", "skills", "home.agents"),
];

/// Config-directory based user-level skill roots.
const USER_CONFIG_SKILL_SLOTS: &[(&str, &str, &str)] = &[
    ("opencode", "skills", "config.opencode"),
    ("agents", "skills", "config.agents"),
];

#[derive(Debug, Clone)]
struct SkillRootEntry {
    path: PathBuf,
    level: SkillLocation,
    slot: &'static str,
    priority: usize,
}

#[derive(Debug, Clone)]
struct RemoteSkillRootEntry {
    path: String,
    slot: &'static str,
    priority: usize,
}

#[derive(Debug, Clone)]
struct SkillCandidate {
    info: SkillInfo,
    priority: usize,
}

impl SkillCandidate {
    fn from_data(mut data: SkillData, slot: &str, key_prefix: &str, priority: usize) -> Self {
        data.source_slot = slot.to_string();
        data.key = build_skill_key(key_prefix, slot, &data.dir_name);
        let is_builtin = data.location == SkillLocation::User
            && slot == "bitfun"
            && is_builtin_skill_dir_name(&data.dir_name);
        let group_key = if is_builtin {
            builtin_skill_group_key(&data.dir_name).map(str::to_string)
        } else {
            None
        };

        Self {
            info: SkillInfo {
                key: data.key,
                name: data.name,
                description: data.description,
                path: data.path,
                level: data.location,
                source_slot: data.source_slot,
                dir_name: data.dir_name,
                is_builtin,
                group_key,
            },
            priority,
        }
    }
}

fn build_skill_key(prefix: &str, slot: &str, dir_name: &str) -> String {
    format!("{}::{}::{}", prefix, slot, dir_name)
}

fn normalize_dir_name(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_remote_dir_name(path: &str) -> Option<String> {
    path.trim_end_matches('/')
        .rsplit('/')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
}

fn dedupe_preserving_order(keys: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();

    for key in keys {
        let trimmed = key.trim();
        if trimmed.is_empty() {
            continue;
        }

        let owned = trimmed.to_string();
        if seen.insert(owned.clone()) {
            normalized.push(owned);
        }
    }

    normalized
}

fn sort_skills(mut skills: Vec<SkillInfo>) -> Vec<SkillInfo> {
    skills.sort_by(|a, b| {
        let level_order = match a.level {
            SkillLocation::Project => 0,
            SkillLocation::User => 1,
        }
        .cmp(&match b.level {
            SkillLocation::Project => 0,
            SkillLocation::User => 1,
        });

        level_order
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.key.cmp(&b.key))
    });
    skills
}

/// Decide whether `challenger` should replace `incumbent` when both expose the same skill name.
///
/// Rules, in order:
/// 1. Within the same level, a Sparo built-in skill always wins over a non-built-in skill.
///    This prevents user-installed copies/forks that keep the same frontmatter `name`
///    (for example an upstream fork installed next to the managed built-in directory)
///    from shadowing the Sparo-managed skill.
/// 2. Otherwise the lower scan priority wins (project roots come before user roots).
/// 3. Equal priority falls back to lexicographic directory name so filesystem scan order
///    can never flip the result between runs.
fn candidate_outranks(challenger: &SkillCandidate, incumbent: &SkillCandidate) -> bool {
    if challenger.info.level == incumbent.info.level
        && challenger.info.is_builtin != incumbent.info.is_builtin
    {
        return challenger.info.is_builtin;
    }
    if challenger.priority != incumbent.priority {
        return challenger.priority < incumbent.priority;
    }
    challenger.info.dir_name < incumbent.info.dir_name
}

fn resolve_visible_skills(candidates: Vec<SkillCandidate>) -> Vec<SkillInfo> {
    let mut by_name: HashMap<String, SkillCandidate> = HashMap::new();
    for candidate in candidates {
        match by_name.get(&candidate.info.name) {
            Some(existing) => {
                if candidate_outranks(&candidate, existing) {
                    debug!(
                        "Skill name collision: name={}, kept_dir={}, shadowed_dir={}",
                        candidate.info.name, candidate.info.dir_name, existing.info.dir_name
                    );
                    by_name.insert(candidate.info.name.clone(), candidate);
                } else {
                    debug!(
                        "Skill name collision: name={}, kept_dir={}, shadowed_dir={}",
                        existing.info.name, existing.info.dir_name, candidate.info.dir_name
                    );
                }
            }
            None => {
                by_name.insert(candidate.info.name.clone(), candidate);
            }
        }
    }

    let mut resolved: Vec<SkillCandidate> = by_name.into_values().collect();
    resolved.sort_by(|a, b| {
        a.priority
            .cmp(&b.priority)
            .then_with(|| a.info.name.to_lowercase().cmp(&b.info.name.to_lowercase()))
    });
    resolved
        .into_iter()
        .map(|candidate| candidate.info)
        .collect()
}

/// Skill registry
pub struct SkillRegistry {
    /// Cached raw user-level skills (no workspace-specific project skills).
    cache: RwLock<Vec<SkillInfo>>,
}

impl SkillRegistry {
    fn new() -> Self {
        Self {
            cache: RwLock::new(Vec::new()),
        }
    }

    pub fn global() -> &'static Self {
        SKILL_REGISTRY.get_or_init(Self::new)
    }

    fn get_possible_paths_for_workspace(workspace_root: Option<&Path>) -> Vec<SkillRootEntry> {
        let mut entries = Vec::new();
        let mut priority = 0usize;

        if let Some(workspace_path) = workspace_root {
            for (parent, sub, slot) in PROJECT_SKILL_SLOTS {
                let path = workspace_path.join(parent).join(sub);
                if path.exists() && path.is_dir() {
                    entries.push(SkillRootEntry {
                        path,
                        level: SkillLocation::Project,
                        slot,
                        priority,
                    });
                }
                priority += 1;
            }
        }

        let path_manager = get_path_manager_arc();
        let bitfun_skills = path_manager.user_skills_dir();
        if bitfun_skills.exists() && bitfun_skills.is_dir() {
            entries.push(SkillRootEntry {
                path: bitfun_skills,
                level: SkillLocation::User,
                slot: "bitfun",
                priority,
            });
        }
        priority += 1;

        if let Some(home) = dirs::home_dir() {
            for (parent, sub, slot) in USER_HOME_SKILL_SLOTS {
                let path = home.join(parent).join(sub);
                if path.exists() && path.is_dir() {
                    entries.push(SkillRootEntry {
                        path,
                        level: SkillLocation::User,
                        slot,
                        priority,
                    });
                }
                priority += 1;
            }
        }

        if let Some(config_dir) = dirs::config_dir() {
            for (parent, sub, slot) in USER_CONFIG_SKILL_SLOTS {
                let path = config_dir.join(parent).join(sub);
                if path.exists() && path.is_dir() {
                    entries.push(SkillRootEntry {
                        path,
                        level: SkillLocation::User,
                        slot,
                        priority,
                    });
                }
                priority += 1;
            }
        }

        entries
    }

    async fn scan_skills_in_dir(entry: &SkillRootEntry) -> Vec<SkillCandidate> {
        let mut skills = Vec::new();
        if !entry.path.exists() {
            return skills;
        }

        let Ok(mut read_dir) = fs::read_dir(&entry.path).await else {
            return skills;
        };

        while let Ok(Some(item)) = read_dir.next_entry().await {
            let path = item.path();
            if !path.is_dir() {
                continue;
            }

            let Some(dir_name) = normalize_dir_name(&path) else {
                continue;
            };

            let skill_md_path = path.join("SKILL.md");
            if !skill_md_path.exists() {
                continue;
            }

            match fs::read_to_string(&skill_md_path).await {
                Ok(content) => match SkillData::from_markdown(
                    path.to_string_lossy().to_string(),
                    &content,
                    entry.level,
                    false,
                ) {
                    Ok(mut skill_data) => {
                        skill_data.dir_name = dir_name;
                        let key_prefix = match entry.level {
                            SkillLocation::User => USER_PREFIX,
                            SkillLocation::Project => PROJECT_PREFIX,
                        };
                        skills.push(SkillCandidate::from_data(
                            skill_data,
                            entry.slot,
                            key_prefix,
                            entry.priority,
                        ));
                    }
                    Err(error) => {
                        error!("Failed to parse SKILL.md in {}: {}", path.display(), error);
                    }
                },
                Err(error) => {
                    debug!("Failed to read {}: {}", skill_md_path.display(), error);
                }
            }
        }

        skills
    }

    async fn scan_skill_candidates_for_workspace(
        &self,
        workspace_root: Option<&Path>,
    ) -> Vec<SkillCandidate> {
        if let Err(error) = ensure_builtin_skills_installed().await {
            debug!("Failed to install built-in skills: {}", error);
        }

        let mut skills = Vec::new();
        for entry in Self::get_possible_paths_for_workspace(workspace_root) {
            let mut part = Self::scan_skills_in_dir(&entry).await;
            skills.append(&mut part);
        }
        skills
    }

    async fn scan_remote_project_skills(
        fs: &dyn WorkspaceFileSystem,
        remote_root: &str,
    ) -> Vec<SkillCandidate> {
        let mut roots = Vec::new();
        let root = remote_root.trim_end_matches('/');
        for (priority, (parent, sub, slot)) in PROJECT_SKILL_SLOTS.iter().enumerate() {
            let path = format!("{}/{}/{}", root, parent, sub);
            if fs.is_dir(&path).await.unwrap_or(false) {
                roots.push(RemoteSkillRootEntry {
                    path,
                    slot,
                    priority,
                });
            }
        }

        let mut skills = Vec::new();
        for entry in roots {
            let entries = match fs.read_dir(&entry.path).await {
                Ok(value) => value,
                Err(_) => continue,
            };

            for item in entries {
                if !item.is_dir || item.is_symlink {
                    continue;
                }

                let Some(dir_name) = normalize_remote_dir_name(&item.path) else {
                    continue;
                };
                let skill_md_path = format!("{}/SKILL.md", item.path.trim_end_matches('/'));
                if !fs.is_file(&skill_md_path).await.unwrap_or(false) {
                    continue;
                }

                match fs.read_file_text(&skill_md_path).await {
                    Ok(content) => match SkillData::from_markdown(
                        item.path.clone(),
                        &content,
                        SkillLocation::Project,
                        false,
                    ) {
                        Ok(mut skill_data) => {
                            skill_data.dir_name = dir_name;
                            skills.push(SkillCandidate::from_data(
                                skill_data,
                                entry.slot,
                                PROJECT_PREFIX,
                                entry.priority,
                            ));
                        }
                        Err(error) => {
                            error!("Failed to parse SKILL.md in {}: {}", item.path, error);
                        }
                    },
                    Err(error) => {
                        debug!("Failed to read {}: {}", skill_md_path, error);
                    }
                }
            }
        }

        skills
    }

    async fn scan_skill_candidates_for_remote_workspace(
        &self,
        fs: &dyn WorkspaceFileSystem,
        remote_root: &str,
    ) -> Vec<SkillCandidate> {
        let mut skills = self.scan_skill_candidates_for_workspace(None).await;
        skills.extend(Self::scan_remote_project_skills(fs, remote_root).await);
        skills
    }

    async fn apply_mode_filters_for_workspace(
        &self,
        candidates: Vec<SkillCandidate>,
        workspace_root: Option<&Path>,
        agent_type: Option<&str>,
    ) -> Vec<SkillCandidate> {
        let Some(agent_id) = agent_type.map(str::trim).filter(|value| !value.is_empty()) else {
            return candidates;
        };

        let user_overrides = load_user_agent_skill_overrides(agent_id)
            .await
            .unwrap_or_else(|_| UserAgentSkillOverrides::default());
        let disabled_project = match workspace_root {
            Some(root) => load_disabled_agent_skills_local(root, agent_id)
                .await
                .unwrap_or_default(),
            None => Vec::new(),
        };

        let disabled_project: HashSet<String> = dedupe_preserving_order(disabled_project)
            .into_iter()
            .collect();

        candidates
            .into_iter()
            .filter(|candidate| {
                is_skill_enabled_for_agent(
                    &candidate.info,
                    agent_id,
                    &user_overrides,
                    &disabled_project,
                )
            })
            .collect()
    }

    async fn apply_mode_filters_for_remote_workspace(
        &self,
        candidates: Vec<SkillCandidate>,
        fs: &dyn WorkspaceFileSystem,
        remote_root: &str,
        agent_type: Option<&str>,
    ) -> Vec<SkillCandidate> {
        let Some(agent_id) = agent_type.map(str::trim).filter(|value| !value.is_empty()) else {
            return candidates;
        };

        let user_overrides = load_user_agent_skill_overrides(agent_id)
            .await
            .unwrap_or_else(|_| UserAgentSkillOverrides::default());
        let disabled_project = load_disabled_agent_skills_remote(fs, remote_root, agent_id)
            .await
            .unwrap_or_default();

        let disabled_project: HashSet<String> = dedupe_preserving_order(disabled_project)
            .into_iter()
            .collect();

        candidates
            .into_iter()
            .filter(|candidate| {
                is_skill_enabled_for_agent(
                    &candidate.info,
                    agent_id,
                    &user_overrides,
                    &disabled_project,
                )
            })
            .collect()
    }

    async fn ensure_loaded(&self) {
        let cache = self.cache.read().await;
        if cache.is_empty() {
            drop(cache);
            self.refresh().await;
        }
    }

    pub async fn refresh(&self) {
        let skills = sort_skills(
            self.scan_skill_candidates_for_workspace(None)
                .await
                .into_iter()
                .map(|candidate| candidate.info)
                .collect(),
        );
        let mut cache = self.cache.write().await;
        *cache = skills;
    }

    pub async fn refresh_for_workspace(&self, _workspace_root: Option<&Path>) {
        self.refresh().await;
    }

    pub async fn get_all_skills(&self) -> Vec<SkillInfo> {
        self.ensure_loaded().await;
        let cache = self.cache.read().await;
        cache.clone()
    }

    pub async fn get_all_skills_for_workspace(
        &self,
        workspace_root: Option<&Path>,
    ) -> Vec<SkillInfo> {
        sort_skills(
            self.scan_skill_candidates_for_workspace(workspace_root)
                .await
                .into_iter()
                .map(|candidate| candidate.info)
                .collect(),
        )
    }

    pub async fn get_all_skills_for_remote_workspace(
        &self,
        fs: &dyn WorkspaceFileSystem,
        remote_root: &str,
    ) -> Vec<SkillInfo> {
        sort_skills(
            self.scan_skill_candidates_for_remote_workspace(fs, remote_root)
                .await
                .into_iter()
                .map(|candidate| candidate.info)
                .collect(),
        )
    }

    pub async fn get_resolved_skills_for_workspace(
        &self,
        workspace_root: Option<&Path>,
        agent_type: Option<&str>,
    ) -> Vec<SkillInfo> {
        let candidates = self
            .scan_skill_candidates_for_workspace(workspace_root)
            .await;
        let filtered = self
            .apply_mode_filters_for_workspace(candidates, workspace_root, agent_type)
            .await;
        resolve_visible_skills(filtered)
    }

    pub async fn get_resolved_skills_for_remote_workspace(
        &self,
        fs: &dyn WorkspaceFileSystem,
        remote_root: &str,
        agent_type: Option<&str>,
    ) -> Vec<SkillInfo> {
        let candidates = self
            .scan_skill_candidates_for_remote_workspace(fs, remote_root)
            .await;
        let filtered = self
            .apply_mode_filters_for_remote_workspace(candidates, fs, remote_root, agent_type)
            .await;
        resolve_visible_skills(filtered)
    }

    pub async fn find_skill_by_key_for_workspace(
        &self,
        skill_key: &str,
        workspace_root: Option<&Path>,
    ) -> Option<SkillInfo> {
        self.get_all_skills_for_workspace(workspace_root)
            .await
            .into_iter()
            .find(|skill| skill.key == skill_key)
    }

    pub async fn find_skill_by_key_for_remote_workspace(
        &self,
        fs: &dyn WorkspaceFileSystem,
        remote_root: &str,
        skill_key: &str,
    ) -> Option<SkillInfo> {
        self.get_all_skills_for_remote_workspace(fs, remote_root)
            .await
            .into_iter()
            .find(|skill| skill.key == skill_key)
    }

    pub async fn find_and_load_skill_for_workspace(
        &self,
        skill_name: &str,
        workspace_root: Option<&Path>,
        agent_type: Option<&str>,
    ) -> BitFunResult<SkillData> {
        let info = self
            .get_resolved_skills_for_workspace(workspace_root, agent_type)
            .await
            .into_iter()
            .find(|skill| skill.name == skill_name)
            .ok_or_else(|| BitFunError::tool(format!("Skill '{}' not found", skill_name)))?;

        let skill_md_path = PathBuf::from(&info.path).join("SKILL.md");
        let content = fs::read_to_string(&skill_md_path)
            .await
            .map_err(|error| BitFunError::tool(format!("Failed to read skill file: {}", error)))?;

        let mut data = SkillData::from_markdown(info.path.clone(), &content, info.level, true)?;
        data.key = info.key;
        data.source_slot = info.source_slot;
        data.dir_name = info.dir_name;
        Ok(data)
    }

    pub async fn find_and_load_skill_for_remote_workspace(
        &self,
        skill_name: &str,
        fs: &dyn WorkspaceFileSystem,
        remote_root: &str,
        agent_type: Option<&str>,
    ) -> BitFunResult<SkillData> {
        let info = self
            .get_resolved_skills_for_remote_workspace(fs, remote_root, agent_type)
            .await
            .into_iter()
            .find(|skill| skill.name == skill_name)
            .ok_or_else(|| BitFunError::tool(format!("Skill '{}' not found", skill_name)))?;

        let content = Self::read_skill_md_for_remote_merge(&info, fs).await?;
        let mut data = SkillData::from_markdown(info.path.clone(), &content, info.level, true)?;
        data.key = info.key;
        data.source_slot = info.source_slot;
        data.dir_name = info.dir_name;
        Ok(data)
    }

    pub async fn get_resolved_skills_xml_for_workspace(
        &self,
        workspace_root: Option<&Path>,
        agent_type: Option<&str>,
    ) -> Vec<String> {
        self.get_resolved_skills_for_workspace(workspace_root, agent_type)
            .await
            .into_iter()
            .map(|skill| skill.to_xml_desc())
            .collect()
    }

    pub async fn get_resolved_skills_xml_for_remote_workspace(
        &self,
        fs: &dyn WorkspaceFileSystem,
        remote_root: &str,
        agent_type: Option<&str>,
    ) -> Vec<String> {
        self.get_resolved_skills_for_remote_workspace(fs, remote_root, agent_type)
            .await
            .into_iter()
            .map(|skill| skill.to_xml_desc())
            .collect()
    }

    async fn read_skill_md_for_remote_merge(
        info: &SkillInfo,
        remote_fs: &dyn WorkspaceFileSystem,
    ) -> BitFunResult<String> {
        match info.level {
            SkillLocation::User => {
                let skill_md_path = PathBuf::from(&info.path).join("SKILL.md");
                fs::read_to_string(&skill_md_path).await.map_err(|error| {
                    BitFunError::tool(format!("Failed to read skill file: {}", error))
                })
            }
            SkillLocation::Project => {
                let skill_md_path = format!("{}/SKILL.md", info.path.trim_end_matches('/'));
                remote_fs
                    .read_file_text(&skill_md_path)
                    .await
                    .map_err(|error| {
                        BitFunError::tool(format!("Failed to read skill file: {}", error))
                    })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(
        name: &str,
        dir_name: &str,
        level: SkillLocation,
        is_builtin: bool,
        priority: usize,
    ) -> SkillCandidate {
        SkillCandidate {
            info: SkillInfo {
                key: format!("test::{}", dir_name),
                name: name.to_string(),
                description: String::new(),
                path: format!("/skills/{}", dir_name),
                level,
                source_slot: "bitfun".to_string(),
                dir_name: dir_name.to_string(),
                is_builtin,
                group_key: None,
            },
            priority,
        }
    }

    #[test]
    fn builtin_skill_wins_same_name_collision_regardless_of_scan_order() {
        // A user-installed fork keeps `name: ppt-design` in its frontmatter while living
        // in a differently named directory next to the managed built-in skill.
        let fork = candidate("ppt-design", "third-party-ppt", SkillLocation::User, false, 4);
        let builtin = candidate("ppt-design", "ppt-design", SkillLocation::User, true, 4);

        for order in [
            vec![fork.clone(), builtin.clone()],
            vec![builtin.clone(), fork.clone()],
        ] {
            let resolved = resolve_visible_skills(order);
            assert_eq!(resolved.len(), 1);
            assert_eq!(resolved[0].dir_name, "ppt-design");
            assert!(resolved[0].is_builtin);
        }
    }

    #[test]
    fn project_skill_still_overrides_builtin_by_priority() {
        let project = candidate("ppt-design", "ppt-design", SkillLocation::Project, false, 0);
        let builtin = candidate("ppt-design", "ppt-design", SkillLocation::User, true, 4);

        let resolved = resolve_visible_skills(vec![builtin, project]);
        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].level, SkillLocation::Project);
    }

    #[test]
    fn equal_priority_non_builtin_collision_is_deterministic() {
        let a = candidate("shared-name", "aaa-skill", SkillLocation::User, false, 5);
        let b = candidate("shared-name", "bbb-skill", SkillLocation::User, false, 5);

        for order in [vec![a.clone(), b.clone()], vec![b.clone(), a.clone()]] {
            let resolved = resolve_visible_skills(order);
            assert_eq!(resolved.len(), 1);
            assert_eq!(resolved[0].dir_name, "aaa-skill");
        }
    }

    #[test]
    fn lower_priority_root_wins_for_same_name() {
        let early = candidate("dup", "dup-early", SkillLocation::User, false, 1);
        let late = candidate("dup", "dup-late", SkillLocation::User, false, 6);

        let resolved = resolve_visible_skills(vec![late, early]);
        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].dir_name, "dup-early");
    }
}
