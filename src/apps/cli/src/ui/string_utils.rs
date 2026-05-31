//! String processing utilities

/// Safely truncate string to specified byte length
pub fn truncate_str(s: &str, max_bytes: usize) -> String {
    let first_line = s.lines().next().unwrap_or("");

    if first_line.len() <= max_bytes {
        return first_line.to_string();
    }

    let mut boundary = max_bytes;
    while boundary > 0 && !first_line.is_char_boundary(boundary) {
        boundary -= 1;
    }

    if boundary == 0 {
        return String::new();
    }

    format!("{}...", &first_line[..boundary])
}

pub fn shell_arg(value: &str) -> String {
    if value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '/' | '\\' | ':'))
    {
        return value.to_string();
    }
    format!("\"{}\"", value.replace('"', "\\\""))
}

pub fn workspace_option(workspace: Option<&str>) -> String {
    workspace
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!(" --workspace {}", shell_arg(value)))
        .unwrap_or_default()
}

/// Prettify tool result display
pub fn prettify_result(s: &str) -> String {
    let first_line = s.lines().next().unwrap_or("");

    let looks_like_debug = first_line.contains("Some(")
        || first_line.contains(": None")
        || (first_line.matches('{').count() > 2)
        || first_line.contains("_tokens:");

    if looks_like_debug {
        if s.contains("Success") || s.contains("Ok") {
            return "Execution successful".to_string();
        } else {
            return "Done".to_string();
        }
    }

    truncate_str(s, 80)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_arg_quotes_only_when_needed() {
        assert_eq!(
            shell_arg("D:\\workspace\\project"),
            "D:\\workspace\\project"
        );
        assert_eq!(shell_arg("my project"), "\"my project\"");
        assert_eq!(shell_arg("say\"hi"), "\"say\\\"hi\"");
    }

    #[test]
    fn workspace_option_uses_shell_arg() {
        assert_eq!(
            workspace_option(Some("D:\\workspace\\my project")),
            " --workspace \"D:\\workspace\\my project\""
        );
        assert_eq!(workspace_option(Some("  ")), "");
        assert_eq!(workspace_option(None), "");
    }
}
