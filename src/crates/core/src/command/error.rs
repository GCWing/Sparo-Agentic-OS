use std::fmt;

pub type CommandResult<T> = Result<T, CommandError>;

#[derive(Debug)]
pub enum CommandError {
    Config { message: String },
    Session { message: String },
    Tool { message: String },
    Serialization { message: String },
}

impl CommandError {
    pub fn config(error: impl fmt::Display) -> Self {
        Self::Config {
            message: error.to_string(),
        }
    }

    pub fn serialization(error: impl fmt::Display) -> Self {
        Self::Serialization {
            message: error.to_string(),
        }
    }

    pub fn session(error: impl fmt::Display) -> Self {
        Self::Session {
            message: error.to_string(),
        }
    }

    pub fn tool(error: impl fmt::Display) -> Self {
        Self::Tool {
            message: error.to_string(),
        }
    }
}

impl fmt::Display for CommandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Config { message } => write!(f, "{}", message),
            Self::Session { message } => write!(f, "{}", message),
            Self::Tool { message } => write!(f, "{}", message),
            Self::Serialization { message } => write!(f, "{}", message),
        }
    }
}

impl std::error::Error for CommandError {}
