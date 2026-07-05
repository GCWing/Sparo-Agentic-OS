use super::*;

impl MCPServerManager {
    pub(super) async fn refresh_resources_catalog(
        &self,
        server_id: &str,
        connection: Arc<MCPConnection>,
    ) -> CoreResult<usize> {
        let mut resources = Vec::new();
        let mut cursor = None::<String>;
        let mut visited = HashSet::new();

        loop {
            let result = connection.list_resources(cursor.clone()).await?;
            resources.extend(result.resources);

            match result.next_cursor {
                Some(next) => {
                    if !visited.insert(next.clone()) {
                        break;
                    }
                    cursor = Some(next);
                }
                None => break,
            }
        }

        let count = resources.len();
        let mut cache = self.resource_catalog_cache.write().await;
        cache.insert(server_id.to_string(), resources);
        Ok(count)
    }

    pub(super) async fn refresh_prompts_catalog(
        &self,
        server_id: &str,
        connection: Arc<MCPConnection>,
    ) -> CoreResult<usize> {
        let mut prompts = Vec::new();
        let mut cursor = None::<String>;
        let mut visited = HashSet::new();

        loop {
            let result = connection.list_prompts(cursor.clone()).await?;
            prompts.extend(result.prompts);

            match result.next_cursor {
                Some(next) => {
                    if !visited.insert(next.clone()) {
                        break;
                    }
                    cursor = Some(next);
                }
                None => break,
            }
        }

        let count = prompts.len();
        let mut cache = self.prompt_catalog_cache.write().await;
        cache.insert(server_id.to_string(), prompts);
        Ok(count)
    }

    pub(super) async fn warm_catalog_caches(
        &self,
        server_id: &str,
        connection: Arc<MCPConnection>,
    ) {
        if let Err(e) = self
            .refresh_resources_catalog(server_id, connection.clone())
            .await
        {
            debug!(
                "Skipping MCP resources catalog warmup: server_id={} error={}",
                server_id, e
            );
        }

        if let Err(e) = self.refresh_prompts_catalog(server_id, connection).await {
            debug!(
                "Skipping MCP prompts catalog warmup: server_id={} error={}",
                server_id, e
            );
        }
    }

    /// Returns cached MCP resources for a server.
    pub async fn get_cached_resources(&self, server_id: &str) -> Vec<MCPResource> {
        self.resource_catalog_cache
            .read()
            .await
            .get(server_id)
            .cloned()
            .unwrap_or_default()
    }

    /// Returns cached MCP prompts for a server.
    pub async fn get_cached_prompts(&self, server_id: &str) -> Vec<MCPPrompt> {
        self.prompt_catalog_cache
            .read()
            .await
            .get(server_id)
            .cloned()
            .unwrap_or_default()
    }

    /// Refreshes resources catalog cache for one server.
    pub async fn refresh_server_resource_catalog(&self, server_id: &str) -> CoreResult<usize> {
        let connection = self.get_connection(server_id).await.ok_or_else(|| {
            CoreError::NotFound(format!("MCP server connection not found: {}", server_id))
        })?;
        self.refresh_resources_catalog(server_id, connection).await
    }

    /// Refreshes prompts catalog cache for one server.
    pub async fn refresh_server_prompt_catalog(&self, server_id: &str) -> CoreResult<usize> {
        let connection = self.get_connection(server_id).await.ok_or_else(|| {
            CoreError::NotFound(format!("MCP server connection not found: {}", server_id))
        })?;
        self.refresh_prompts_catalog(server_id, connection).await
    }
}
