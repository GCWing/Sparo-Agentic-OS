use serde::{Deserialize, Serialize};

use crate::agentic::coordination::ConversationCoordinator;
use crate::agentic::core::SessionDomain;
use crate::command::{CommandError, CommandResult};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsFlowSessionResponse {
    pub session_id: String,
    pub session_name: String,
    pub agent_type: String,
    pub workspace_path: String,
    pub domain: SessionDomain,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResetSettingsFlowSessionRequest {
    pub session_id: String,
}

fn settings_flow_session_response(
    session: crate::agentic::core::Session,
) -> CommandResult<SettingsFlowSessionResponse> {
    let workspace_path = session.config.workspace_path.ok_or_else(|| {
        CommandError::session("SettingsAgent session is missing its runtime workspace")
    })?;
    Ok(SettingsFlowSessionResponse {
        session_id: session.session_id,
        session_name: session.session_name,
        agent_type: session.agent_type,
        workspace_path,
        domain: session.config.domain,
    })
}

const SENSITIVE_SETTING_LABELS: &[&str] = &[
    "api key",
    "api_key",
    "api-key",
    "apikey",
    "access token",
    "access_token",
    "access-token",
    "api token",
    "auth token",
    "bearer token",
    "authorization",
    "client secret",
    "private key",
    "password",
    "secret",
    "credential",
    "密钥",
    "令牌",
    "密码",
    "凭据",
];

const SECRET_ASSIGNMENT_MARKERS: &[&str] = &[
    "=",
    ":",
    "：",
    "改成",
    "设置为",
    "设为",
    "换成",
    "to ",
    "is ",
];

const TRUSTED_SECRET_STATE_VALUES: &[&str] = &[
    "configured",
    "set",
    "present",
    "unchanged",
    "已配置",
    "已设置",
    "存在",
    "保持不变",
];

fn strip_token_punctuation(value: &str) -> &str {
    value.trim_matches(|character: char| {
        character.is_whitespace()
            || matches!(
                character,
                ',' | '.'
                    | ';'
                    | ':'
                    | '，'
                    | '。'
                    | '；'
                    | '：'
                    | '"'
                    | '\''
                    | '`'
                    | '('
                    | ')'
                    | '['
                    | ']'
                    | '{'
                    | '}'
            )
    })
}

fn has_known_credential_shape(part: &str) -> bool {
    let token = strip_token_punctuation(part).to_lowercase();
    (token.starts_with("sk-") && token.len() >= 12)
        || (["ghp_", "gho_", "ghu_", "ghs_", "ghr_"]
            .iter()
            .any(|prefix| token.starts_with(prefix))
            && token.len() >= 16)
        || (["xoxb-", "xoxa-", "xoxp-", "xoxr-", "xoxs-"]
            .iter()
            .any(|prefix| token.starts_with(prefix))
            && token.len() >= 16)
        || (token.starts_with("aiza") && token.len() >= 20)
        || (token.starts_with("akia") && token.len() == 20)
}

fn looks_like_credential_value(raw_value: &str) -> bool {
    let value = strip_token_punctuation(raw_value);
    !value.is_empty()
        && !TRUSTED_SECRET_STATE_VALUES
            .iter()
            .any(|state| value.eq_ignore_ascii_case(state))
        && !value
            .to_ascii_lowercase()
            .starts_with("__sparo_secret_ref__")
}

fn contains_assigned_credential(tail: &str) -> bool {
    let tail = tail.trim_start();
    SECRET_ASSIGNMENT_MARKERS.iter().any(|marker| {
        tail.strip_prefix(marker).is_some_and(|candidate| {
            candidate
                .trim()
                .split_whitespace()
                .next()
                .is_some_and(looks_like_credential_value)
        })
    })
}

pub fn contains_sensitive_credential(prompt: &str) -> bool {
    let normalized = prompt.to_lowercase();
    if normalized
        .split_whitespace()
        .any(has_known_credential_shape)
    {
        return true;
    }

    SENSITIVE_SETTING_LABELS.iter().any(|label| {
        normalized.match_indices(label).any(|(label_start, _)| {
            contains_assigned_credential(&normalized[label_start + label.len()..])
        })
    })
}

pub async fn ensure_settings_flow_session(
    coordinator: &ConversationCoordinator,
) -> CommandResult<SettingsFlowSessionResponse> {
    let session = coordinator
        .ensure_settings_agent_session()
        .await
        .map_err(CommandError::session)?;
    settings_flow_session_response(session)
}

pub async fn reset_settings_flow_session(
    coordinator: &ConversationCoordinator,
    request: ResetSettingsFlowSessionRequest,
) -> CommandResult<SettingsFlowSessionResponse> {
    let session = coordinator
        .reset_settings_agent_session(&request.session_id)
        .await
        .map_err(CommandError::session)?;
    settings_flow_session_response(session)
}

#[cfg(test)]
mod tests {
    use super::contains_sensitive_credential;

    #[test]
    fn detects_credentials_without_echoing_them_into_a_session() {
        assert!(contains_sensitive_credential(
            "Set my API key to sk-example-secret-value"
        ));
        assert!(contains_sensitive_credential(
            "把访问令牌设置为 abcdefghijklmnop"
        ));
        assert!(contains_sensitive_credential(
            "use ghp_0123456789abcdef for this provider"
        ));
        assert!(contains_sensitive_credential("Set my API key to x"));
        assert!(contains_sensitive_credential("password = 7"));
        assert!(contains_sensitive_credential("把密码设为 abc"));
    }

    #[test]
    fn allows_questions_that_do_not_contain_a_credential_value() {
        assert!(!contains_sensitive_credential(
            "How do I configure an API key?"
        ));
        assert!(!contains_sensitive_credential(
            "The API key has already been configured"
        ));
        assert!(!contains_sensitive_credential("The API key is configured"));
        assert!(!contains_sensitive_credential("The API key is set"));
        assert!(!contains_sensitive_credential("The API key is present"));
        assert!(!contains_sensitive_credential("The API key is unchanged"));
        assert!(!contains_sensitive_credential("把密码设为已配置"));
        assert!(!contains_sensitive_credential("把密码设为已设置"));
        assert!(!contains_sensitive_credential("把密码设为存在"));
        assert!(!contains_sensitive_credential("把密码设为保持不变"));
        assert!(!contains_sensitive_credential(
            "API key = __SPARO_SECRET_REF__:vault-entry"
        ));
        assert!(!contains_sensitive_credential("打开模型设置中的凭据页面"));
    }
}
