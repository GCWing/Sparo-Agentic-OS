use log::{info, warn};
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use crate::error::{CoreError, CoreResult};
use crate::service::config::catalog::SETTING_MCP_SERVERS;
use crate::service::config::{ConfigPatchOperation, ConfigService};
use crate::service::mcp::server::MCPServerConfig;
use sparo_events::{ConfigChangeSource, ConfigChangeSourceKind};

use super::ConfigLocation;

/// MCP configuration service.
pub struct MCPConfigService {
    pub(super) config_service: Arc<ConfigService>,
}

impl MCPConfigService {
    const AUTHORIZATION_KEYS: [&'static str; 3] =
        ["Authorization", "authorization", "AUTHORIZATION"];

    pub(super) async fn commit_user_servers(
        &self,
        value: serde_json::Value,
        surface: &'static str,
    ) -> CoreResult<()> {
        self.config_service
            .commit_operations(
                ConfigChangeSource {
                    kind: ConfigChangeSourceKind::Manual,
                    surface: Some(surface.to_string()),
                    request_id: None,
                },
                vec![ConfigPatchOperation::Set {
                    setting_id: SETTING_MCP_SERVERS.to_string(),
                    value,
                }],
                true,
            )
            .await
            .map(|_| ())
    }

    fn config_signature(config: &MCPServerConfig) -> String {
        let env: BTreeMap<_, _> = config.env.clone().into_iter().collect();
        let headers: BTreeMap<_, _> = config.headers.clone().into_iter().collect();
        serde_json::json!({
            "serverType": config.server_type,
            "transport": config.resolved_transport().as_str(),
            "command": config.command,
            "args": config.args,
            "env": env,
            "headers": headers,
            "url": config.url,
            "oauth": config.oauth,
            "xaa": config.xaa,
        })
        .to_string()
    }

    fn precedence(location: ConfigLocation) -> u8 {
        match location {
            ConfigLocation::BuiltIn => 0,
            ConfigLocation::User => 1,
            ConfigLocation::Project => 2,
        }
    }

    fn merge_configs(
        merged: &mut Vec<MCPServerConfig>,
        source: Vec<MCPServerConfig>,
        signature_index: &mut HashMap<String, usize>,
        id_index: &mut HashMap<String, usize>,
    ) {
        for config in source {
            let config_id = config.id.clone();
            let signature = Self::config_signature(&config);

            if let Some(existing_index) = id_index.get(&config_id).copied() {
                let previous = &merged[existing_index];
                warn!(
                    "Overriding MCP config by id: id={} previous_location={:?} new_location={:?}",
                    config_id, previous.location, config.location
                );

                let previous_signature = Self::config_signature(previous);
                merged[existing_index] = config;
                signature_index.remove(&previous_signature);
                signature_index.insert(signature, existing_index);
                continue;
            }

            if let Some(existing_index) = signature_index.get(&signature).copied() {
                let previous = &merged[existing_index];
                if Self::precedence(previous.location) <= Self::precedence(config.location) {
                    warn!(
                        "Deduplicating MCP config by content signature: previous_id={} previous_location={:?} replacement_id={} replacement_location={:?}",
                        previous.id, previous.location, config_id, config.location
                    );

                    id_index.remove(&previous.id);
                    merged[existing_index] = config;
                    id_index.insert(config_id, existing_index);
                    signature_index.insert(signature, existing_index);
                }
                continue;
            }

            let next_index = merged.len();
            signature_index.insert(signature, next_index);
            id_index.insert(config_id, next_index);
            merged.push(config);
        }
    }

    fn parse_config_array(
        &self,
        servers: &[serde_json::Value],
        location: ConfigLocation,
    ) -> CoreResult<Vec<MCPServerConfig>> {
        servers
            .iter()
            .enumerate()
            .map(|(index, value)| {
                let mut config =
                    serde_json::from_value::<MCPServerConfig>(value.clone()).map_err(|error| {
                        CoreError::validation(format!(
                            "Invalid MCP config item at {:?} scope index {}: {}",
                            location, index, error
                        ))
                    })?;
                config.location = location;
                Ok(config)
            })
            .collect()
    }

    fn normalize_authorization_value(value: &str) -> Option<String> {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return None;
        }

        if trimmed.to_ascii_lowercase().starts_with("bearer ")
            || trimmed.contains(char::is_whitespace)
        {
            return Some(trimmed.to_string());
        }

        Some(format!("Bearer {}", trimmed))
    }

    fn config_authorization_from_map(
        map: &std::collections::HashMap<String, String>,
    ) -> Option<String> {
        Self::AUTHORIZATION_KEYS
            .iter()
            .find_map(|key| map.get(*key).cloned())
            .filter(|value| !value.trim().is_empty())
    }

    fn remove_authorization_keys(map: &mut std::collections::HashMap<String, String>) {
        for key in Self::AUTHORIZATION_KEYS {
            map.remove(key);
        }
    }

    pub fn get_remote_authorization_value(config: &MCPServerConfig) -> Option<String> {
        Self::config_authorization_from_map(&config.headers)
            .or_else(|| Self::config_authorization_from_map(&config.env))
    }

    pub fn get_remote_authorization_source(config: &MCPServerConfig) -> Option<&'static str> {
        if Self::config_authorization_from_map(&config.headers).is_some() {
            Some("headers")
        } else if Self::config_authorization_from_map(&config.env).is_some() {
            Some("env")
        } else {
            None
        }
    }

    pub fn has_remote_authorization(config: &MCPServerConfig) -> bool {
        Self::get_remote_authorization_value(config).is_some()
    }

    pub fn has_remote_oauth(config: &MCPServerConfig) -> bool {
        config.oauth.is_some()
    }

    pub fn has_remote_xaa(config: &MCPServerConfig) -> bool {
        config.xaa.is_some()
    }

    /// Creates a new MCP configuration service.
    pub fn new(config_service: Arc<ConfigService>) -> CoreResult<Self> {
        Ok(Self { config_service })
    }

    /// Loads all MCP server configurations.
    pub async fn load_all_configs(&self) -> CoreResult<Vec<MCPServerConfig>> {
        let builtin_configs = self.load_builtin_configs().await?;
        let user_configs = self.load_user_configs().await?;

        let project_configs = self.load_project_configs().await?;

        let mut configs = Vec::new();
        let mut signature_index = HashMap::new();
        let mut id_index = HashMap::new();

        Self::merge_configs(
            &mut configs,
            builtin_configs,
            &mut signature_index,
            &mut id_index,
        );
        Self::merge_configs(
            &mut configs,
            user_configs,
            &mut signature_index,
            &mut id_index,
        );
        Self::merge_configs(
            &mut configs,
            project_configs,
            &mut signature_index,
            &mut id_index,
        );

        Ok(configs)
    }

    /// Loads built-in configurations.
    async fn load_builtin_configs(&self) -> CoreResult<Vec<MCPServerConfig>> {
        Ok(Vec::new())
    }

    /// Loads user-level configuration (supports Cursor format `{ "mcpServers": { "id": {..} } }`
    /// and array format `[{..}]`).
    async fn load_user_configs(&self) -> CoreResult<Vec<MCPServerConfig>> {
        let config_value = self
            .config_service
            .get_config::<serde_json::Value>(Some("mcp_servers"))
            .await?;
        if config_value.is_null() {
            return Ok(Vec::new());
        }
        if config_value
            .get("mcpServers")
            .and_then(|value| value.as_object())
            .is_some()
        {
            return super::cursor_format::parse_cursor_format(&config_value);
        }
        if let Some(servers) = config_value.as_array() {
            return self.parse_config_array(servers, ConfigLocation::User);
        }

        Err(CoreError::validation(
            "Invalid MCP configuration: expected null, an array, or an object containing 'mcpServers'",
        ))
    }

    /// Loads project-level configuration.
    async fn load_project_configs(&self) -> CoreResult<Vec<MCPServerConfig>> {
        Ok(Vec::new())
    }

    /// Gets a single server configuration.
    pub async fn get_server_config(&self, server_id: &str) -> CoreResult<Option<MCPServerConfig>> {
        let all_configs = self.load_all_configs().await?;
        Ok(all_configs.into_iter().find(|c| c.id == server_id))
    }

    /// Saves a server configuration.
    pub async fn save_server_config(&self, config: &MCPServerConfig) -> CoreResult<()> {
        match config.location {
            ConfigLocation::BuiltIn => Err(CoreError::Configuration(
                "Cannot modify built-in MCP server configuration".to_string(),
            )),
            ConfigLocation::User => self.save_user_config(config).await,
            ConfigLocation::Project => self.save_project_config(config).await,
        }
    }

    pub async fn set_remote_authorization(
        &self,
        server_id: &str,
        authorization_value: &str,
    ) -> CoreResult<MCPServerConfig> {
        let mut config = self.get_server_config(server_id).await?.ok_or_else(|| {
            CoreError::NotFound(format!("MCP server config not found: {}", server_id))
        })?;

        if config.server_type != crate::service::mcp::server::MCPServerType::Remote {
            return Err(CoreError::Validation(format!(
                "MCP server '{}' is not a remote server",
                server_id
            )));
        }

        let normalized =
            Self::normalize_authorization_value(authorization_value).ok_or_else(|| {
                CoreError::Validation("Authorization value cannot be empty".to_string())
            })?;

        Self::remove_authorization_keys(&mut config.headers);
        Self::remove_authorization_keys(&mut config.env);
        config
            .headers
            .insert("Authorization".to_string(), normalized);

        self.save_server_config(&config).await?;
        Ok(config)
    }

    pub async fn clear_remote_authorization(&self, server_id: &str) -> CoreResult<MCPServerConfig> {
        let mut config = self.get_server_config(server_id).await?.ok_or_else(|| {
            CoreError::NotFound(format!("MCP server config not found: {}", server_id))
        })?;

        if config.server_type != crate::service::mcp::server::MCPServerType::Remote {
            return Err(CoreError::Validation(format!(
                "MCP server '{}' is not a remote server",
                server_id
            )));
        }

        Self::remove_authorization_keys(&mut config.headers);
        Self::remove_authorization_keys(&mut config.env);
        self.save_server_config(&config).await?;
        Ok(config)
    }

    /// Saves user-level configuration.
    async fn save_user_config(&self, config: &MCPServerConfig) -> CoreResult<()> {
        let current_value = self
            .config_service
            .get_config::<serde_json::Value>(Some("mcp_servers"))
            .await?;

        let mut mcp_servers =
            if let Some(obj) = current_value.get("mcpServers").and_then(|v| v.as_object()) {
                obj.clone()
            } else {
                serde_json::Map::new()
            };

        let cursor_format = super::cursor_format::config_to_cursor_format(config);

        mcp_servers.insert(config.id.clone(), cursor_format);

        let new_value = serde_json::json!({
            "mcpServers": mcp_servers
        });

        self.commit_user_servers(new_value, "mcp-config").await?;
        info!(
            "Saved user-level MCP server config (Cursor format): {}",
            config.id
        );
        Ok(())
    }

    /// Saves project-level configuration.
    async fn save_project_config(&self, _config: &MCPServerConfig) -> CoreResult<()> {
        Err(CoreError::validation(
            "Project-scoped MCP configuration is unavailable until workspace config scope is enabled",
        ))
    }

    /// Deletes a server configuration.
    pub async fn delete_server_config(&self, server_id: &str) -> CoreResult<()> {
        let current_value = self
            .config_service
            .get_config::<serde_json::Value>(Some("mcp_servers"))
            .await?;

        let mut mcp_servers =
            if let Some(obj) = current_value.get("mcpServers").and_then(|v| v.as_object()) {
                obj.clone()
            } else {
                return Err(CoreError::NotFound(format!(
                    "MCP server config not found: {}",
                    server_id
                )));
            };

        if mcp_servers.remove(server_id).is_none() {
            return Err(CoreError::NotFound(format!(
                "MCP server config not found: {}",
                server_id
            )));
        }

        let new_value = serde_json::json!({
            "mcpServers": mcp_servers
        });

        self.commit_user_servers(new_value, "mcp-config").await?;
        info!("Deleted MCP server config: {}", server_id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::mcp::server::MCPServerType;

    fn make_config(
        id: &str,
        location: ConfigLocation,
        server_type: MCPServerType,
        command: Option<&str>,
        url: Option<&str>,
    ) -> MCPServerConfig {
        MCPServerConfig {
            id: id.to_string(),
            name: id.to_string(),
            server_type,
            transport: None,
            command: command.map(str::to_string),
            args: Vec::new(),
            env: HashMap::new(),
            headers: HashMap::new(),
            url: url.map(str::to_string),
            auto_start: true,
            enabled: true,
            location,
            capabilities: Vec::new(),
            settings: Default::default(),
            oauth: None,
            xaa: None,
        }
    }

    #[test]
    fn merge_configs_prefers_higher_precedence_when_ids_match() {
        let mut merged = Vec::new();
        let mut signature_index = HashMap::new();
        let mut id_index = HashMap::new();

        MCPConfigService::merge_configs(
            &mut merged,
            vec![make_config(
                "github",
                ConfigLocation::User,
                MCPServerType::Remote,
                None,
                Some("https://example.com/mcp"),
            )],
            &mut signature_index,
            &mut id_index,
        );
        MCPConfigService::merge_configs(
            &mut merged,
            vec![make_config(
                "github",
                ConfigLocation::Project,
                MCPServerType::Remote,
                None,
                Some("https://project.example.com/mcp"),
            )],
            &mut signature_index,
            &mut id_index,
        );

        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].location, ConfigLocation::Project);
        assert_eq!(
            merged[0].url.as_deref(),
            Some("https://project.example.com/mcp")
        );
    }

    #[test]
    fn merge_configs_deduplicates_same_server_content_across_ids() {
        let mut merged = Vec::new();
        let mut signature_index = HashMap::new();
        let mut id_index = HashMap::new();

        MCPConfigService::merge_configs(
            &mut merged,
            vec![make_config(
                "github-user",
                ConfigLocation::User,
                MCPServerType::Remote,
                None,
                Some("https://example.com/mcp"),
            )],
            &mut signature_index,
            &mut id_index,
        );
        MCPConfigService::merge_configs(
            &mut merged,
            vec![make_config(
                "github-project",
                ConfigLocation::Project,
                MCPServerType::Remote,
                None,
                Some("https://example.com/mcp"),
            )],
            &mut signature_index,
            &mut id_index,
        );

        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].id, "github-project");
        assert_eq!(merged[0].location, ConfigLocation::Project);
    }

    #[test]
    fn remote_authorization_prefers_headers_and_normalizes_tokens() {
        let mut config = make_config(
            "remote-auth",
            ConfigLocation::User,
            MCPServerType::Remote,
            None,
            Some("https://example.com/mcp"),
        );
        config
            .env
            .insert("Authorization".to_string(), "legacy-token".to_string());
        config.headers.insert(
            "Authorization".to_string(),
            "Bearer header-token".to_string(),
        );

        assert_eq!(
            MCPConfigService::get_remote_authorization_value(&config).as_deref(),
            Some("Bearer header-token")
        );
        assert_eq!(
            MCPConfigService::get_remote_authorization_source(&config),
            Some("headers")
        );
        assert_eq!(
            MCPConfigService::normalize_authorization_value("plain-token").as_deref(),
            Some("Bearer plain-token")
        );
    }
}
