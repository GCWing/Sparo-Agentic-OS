//! Trusted structural classification for configuration credentials.
//!
//! Secret handling must follow the configuration contract, not attacker-
//! controlled child names. In particular, every value inside a credential map
//! is sensitive even when its key is an arbitrary environment variable or HTTP
//! header name.

#[derive(Debug, Clone, Default)]
pub(crate) struct ConfigSecretPath {
    segments: Vec<String>,
    sensitive: bool,
}

impl ConfigSecretPath {
    pub(crate) fn root() -> Self {
        Self::default()
    }

    pub(crate) fn from_storage_path(path: &str) -> Self {
        path.split('.')
            .filter(|segment| !segment.is_empty())
            .fold(Self::root(), |path, segment| path.child(segment))
    }

    pub(crate) fn child(&self, field: &str) -> Self {
        let mut segments = self.segments.clone();
        segments.push(normalize_segment(field));
        let sensitive =
            self.sensitive || is_secret_key(field) || is_credential_container_path(&segments);
        Self {
            segments,
            sensitive,
        }
    }

    pub(crate) fn is_sensitive(&self) -> bool {
        self.sensitive
    }
}

/// Name-based detection remains a defense-in-depth rule for scalar credential
/// fields. Structural credential containers are classified separately so
/// arbitrary child keys cannot bypass the policy.
pub(crate) fn is_secret_key(key: &str) -> bool {
    let normalized = normalize_segment(key);
    normalized.contains("apikey")
        || normalized == "token"
        || normalized.ends_with("token")
        || normalized.contains("secret")
        || normalized.contains("password")
        || normalized.contains("authorization")
        || normalized.contains("credential")
}

fn is_credential_container_path(segments: &[String]) -> bool {
    let Some(field) = segments.last().map(String::as_str) else {
        return false;
    };

    let mcp_credential_map = segments.first().map(String::as_str) == Some("mcpservers")
        && matches!(field, "env" | "headers");
    let ai_model_credential_map = segments.get(0).map(String::as_str) == Some("ai")
        && segments.get(1).map(String::as_str) == Some("models")
        && matches!(field, "customheaders" | "extraheaders");

    mcp_credential_map || ai_model_credential_map
}

fn normalize_segment(segment: &str) -> String {
    segment
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_trusted_credential_containers_without_tainting_ordinary_maps() {
        let mcp = ConfigSecretPath::from_storage_path("mcp_servers")
            .child("mcpServers")
            .child("private");
        assert!(mcp.child("env").child("FOO").is_sensitive());
        assert!(mcp.child("headers").child("Cookie").is_sensitive());

        let model = ConfigSecretPath::from_storage_path("ai.models");
        assert!(model
            .child("custom_headers")
            .child("X-Custom")
            .is_sensitive());
        assert!(model.child("api_key").is_sensitive());

        let ordinary = ConfigSecretPath::from_storage_path("product_apps.apps.demo");
        assert!(!ordinary.child("env").child("FOO").is_sensitive());
        assert!(!ordinary.child("headers").child("X-Custom").is_sensitive());
    }
}
