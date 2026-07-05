//! Core error types shared by Sparo OS services, agents, and tools.

use serde::Serialize;
use thiserror::Error;

/// Stable, product-neutral error type for platform-agnostic Sparo OS core code.
#[derive(Debug, Error, Serialize)]
pub enum CoreError {
    #[error("Service error: {0}")]
    Service(String),

    #[error("Agent error: {0}")]
    Agent(String),

    #[error("Tool error: {0}")]
    Tool(String),

    #[error("AI client error: {0}")]
    AiClient(String),

    #[error("Session error: {0}")]
    Session(String),

    #[error("Workspace error: {0}")]
    Workspace(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("IO error: {0}")]
    #[serde(serialize_with = "serialize_io_error")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    #[serde(serialize_with = "serialize_serde_error")]
    Serialization(#[from] serde_json::Error),

    #[error("HTTP error: {0}")]
    #[serde(serialize_with = "serialize_reqwest_error")]
    Http(#[from] reqwest::Error),

    #[error("Other error: {0}")]
    #[serde(serialize_with = "serialize_anyhow_error")]
    Other(#[from] anyhow::Error),

    #[error("Semaphore acquire error: {0}")]
    Semaphore(String),

    #[error("MCP error: {0}")]
    Mcp(String),

    #[error("Process error: {0}")]
    Process(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Not implemented: {0}")]
    NotImplemented(String),

    #[error("Timeout: {0}")]
    Timeout(String),

    #[error("Configuration error: {0}")]
    Configuration(String),

    #[error("Deserialization error: {0}")]
    Deserialization(String),

    #[error("Cancelled: {0}")]
    Cancelled(String),
}

pub type CoreResult<T> = Result<T, CoreError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CoreErrorKind {
    Service,
    Agent,
    Tool,
    AiClient,
    Session,
    Workspace,
    Validation,
    Io,
    Serialization,
    Http,
    Other,
    Semaphore,
    Mcp,
    Process,
    NotFound,
    NotImplemented,
    Timeout,
    Configuration,
    Deserialization,
    Cancelled,
}

impl CoreError {
    pub fn kind(&self) -> CoreErrorKind {
        match self {
            Self::Service(_) => CoreErrorKind::Service,
            Self::Agent(_) => CoreErrorKind::Agent,
            Self::Tool(_) => CoreErrorKind::Tool,
            Self::AiClient(_) => CoreErrorKind::AiClient,
            Self::Session(_) => CoreErrorKind::Session,
            Self::Workspace(_) => CoreErrorKind::Workspace,
            Self::Validation(_) => CoreErrorKind::Validation,
            Self::Io(_) => CoreErrorKind::Io,
            Self::Serialization(_) => CoreErrorKind::Serialization,
            Self::Http(_) => CoreErrorKind::Http,
            Self::Other(_) => CoreErrorKind::Other,
            Self::Semaphore(_) => CoreErrorKind::Semaphore,
            Self::Mcp(_) => CoreErrorKind::Mcp,
            Self::Process(_) => CoreErrorKind::Process,
            Self::NotFound(_) => CoreErrorKind::NotFound,
            Self::NotImplemented(_) => CoreErrorKind::NotImplemented,
            Self::Timeout(_) => CoreErrorKind::Timeout,
            Self::Configuration(_) => CoreErrorKind::Configuration,
            Self::Deserialization(_) => CoreErrorKind::Deserialization,
            Self::Cancelled(_) => CoreErrorKind::Cancelled,
        }
    }

    pub fn code(&self) -> &'static str {
        match self.kind() {
            CoreErrorKind::Service => "core.service",
            CoreErrorKind::Agent => "core.agent",
            CoreErrorKind::Tool => "core.tool",
            CoreErrorKind::AiClient => "core.ai_client",
            CoreErrorKind::Session => "core.session",
            CoreErrorKind::Workspace => "core.workspace",
            CoreErrorKind::Validation => "core.validation",
            CoreErrorKind::Io => "core.io",
            CoreErrorKind::Serialization => "core.serialization",
            CoreErrorKind::Http => "core.http",
            CoreErrorKind::Other => "core.other",
            CoreErrorKind::Semaphore => "core.semaphore",
            CoreErrorKind::Mcp => "core.mcp",
            CoreErrorKind::Process => "core.process",
            CoreErrorKind::NotFound => "core.not_found",
            CoreErrorKind::NotImplemented => "core.not_implemented",
            CoreErrorKind::Timeout => "core.timeout",
            CoreErrorKind::Configuration => "core.configuration",
            CoreErrorKind::Deserialization => "core.deserialization",
            CoreErrorKind::Cancelled => "core.cancelled",
        }
    }

    pub fn service<T: Into<String>>(msg: T) -> Self {
        Self::Service(msg.into())
    }

    pub fn agent<T: Into<String>>(msg: T) -> Self {
        Self::Agent(msg.into())
    }

    pub fn tool<T: Into<String>>(msg: T) -> Self {
        Self::Tool(msg.into())
    }

    pub fn config<T: Into<String>>(msg: T) -> Self {
        Self::Configuration(msg.into())
    }

    pub fn validation<T: Into<String>>(msg: T) -> Self {
        Self::Validation(msg.into())
    }

    pub fn ai<T: Into<String>>(msg: T) -> Self {
        Self::AiClient(msg.into())
    }

    pub fn parse<T: Into<String>>(msg: T) -> Self {
        Self::Deserialization(msg.into())
    }

    pub fn workspace<T: Into<String>>(msg: T) -> Self {
        Self::Workspace(msg.into())
    }

    pub fn serialization<T: Into<String>>(msg: T) -> Self {
        Self::Serialization(serde_json::Error::io(std::io::Error::other(msg.into())))
    }

    pub fn session<T: Into<String>>(msg: T) -> Self {
        Self::Session(msg.into())
    }

    pub fn io<T: Into<String>>(msg: T) -> Self {
        Self::Io(std::io::Error::other(msg.into()))
    }

    pub fn cancelled<T: Into<String>>(msg: T) -> Self {
        Self::Cancelled(msg.into())
    }
}

fn serialize_io_error<S>(err: &std::io::Error, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serializer.serialize_str(&err.to_string())
}

fn serialize_serde_error<S>(err: &serde_json::Error, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serializer.serialize_str(&err.to_string())
}

fn serialize_reqwest_error<S>(err: &reqwest::Error, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serializer.serialize_str(&err.to_string())
}

fn serialize_anyhow_error<S>(err: &anyhow::Error, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serializer.serialize_str(&err.to_string())
}

impl From<CoreError> for String {
    fn from(err: CoreError) -> String {
        err.to_string()
    }
}

impl From<String> for CoreError {
    fn from(error: String) -> Self {
        CoreError::Service(error)
    }
}

impl From<&str> for CoreError {
    fn from(error: &str) -> Self {
        CoreError::Service(error.to_string())
    }
}

impl From<tokio::sync::AcquireError> for CoreError {
    fn from(error: tokio::sync::AcquireError) -> Self {
        CoreError::Semaphore(error.to_string())
    }
}
