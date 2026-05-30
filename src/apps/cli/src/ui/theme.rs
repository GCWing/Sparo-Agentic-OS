/// Sparo terminal theme and style definitions.
use ratatui::style::{Color, Modifier, Style};

#[derive(Debug, Clone)]
pub struct Theme {
    pub ignition: Color,
    pub text: Color,
    pub slate: Color,
    pub muted: Color,
    pub faint: Color,
    pub success: Color,
    pub warning: Color,
    pub error: Color,
    pub border: Color,
}

impl Default for Theme {
    fn default() -> Self {
        Self::dark()
    }
}

impl Theme {
    pub fn dark() -> Self {
        Self {
            ignition: Color::Rgb(183, 55, 47),
            text: Color::Rgb(226, 232, 240),
            slate: Color::Rgb(91, 107, 140),
            muted: Color::Rgb(91, 107, 140),
            faint: Color::Rgb(58, 66, 82),
            success: Color::Rgb(58, 157, 106),
            warning: Color::Rgb(210, 164, 74),
            error: Color::Rgb(211, 80, 75),
            border: Color::Rgb(58, 66, 82),
        }
    }

    pub fn light() -> Self {
        Self {
            ignition: Color::Rgb(183, 55, 47),
            text: Color::Rgb(22, 28, 40),
            slate: Color::Rgb(91, 107, 140),
            muted: Color::Rgb(91, 107, 140),
            faint: Color::Rgb(151, 160, 178),
            success: Color::Rgb(36, 132, 85),
            warning: Color::Rgb(166, 116, 35),
            error: Color::Rgb(185, 57, 51),
            border: Color::Rgb(151, 160, 178),
        }
    }

    pub fn style(&self, kind: StyleKind) -> Style {
        match kind {
            StyleKind::Primary => Style::default().fg(self.ignition),
            StyleKind::Success => Style::default().fg(self.success),
            StyleKind::Warning => Style::default().fg(self.warning),
            StyleKind::Error => Style::default().fg(self.error),
            StyleKind::Info => Style::default().fg(self.slate),
            StyleKind::Muted => Style::default().fg(self.slate),
            StyleKind::Faint => Style::default().fg(self.faint),
            StyleKind::Text => Style::default().fg(self.text),
            StyleKind::Title => Style::default()
                .fg(self.text)
                .add_modifier(Modifier::BOLD),
            StyleKind::AccentTitle => Style::default()
                .fg(self.ignition)
                .add_modifier(Modifier::BOLD),
            StyleKind::Border => Style::default().fg(self.border),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub enum StyleKind {
    Primary,
    Success,
    Warning,
    Error,
    Info,
    Muted,
    Faint,
    Text,
    Title,
    AccentTitle,
    Border,
}

pub fn tool_icon(tool_name: &str) -> &'static str {
    match tool_name {
        "FileReadTool" | "read_file" | "read_file_tool" => "Read",
        "FileWriteTool" | "write_file" | "write_file_tool" | "search_replace" => "Edit",
        "FileEditTool" => "Edit",
        "FileDeleteTool" => "Delete",
        "BashTool" | "ShellTool" | "bash_tool" | "run_terminal_cmd" => "Bash",
        "SearchTool" | "codebase_search" | "grep" => "Search",
        "list_dir" | "ls" => "List",
        "AnalysisTool" => "Think",
        _ => "Tool",
    }
}
