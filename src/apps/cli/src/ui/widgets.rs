/// Custom TUI widgets
use ratatui::{
    style::Style,
    text::{Line, Span},
};

pub struct Spinner {
    frame: usize,
}

impl Spinner {
    const FRAMES: &'static [&'static str] = &["-", "\\", "|", "/"];

    pub fn new(_style: Style) -> Self {
        Self { frame: 0 }
    }

    pub fn tick(&mut self) {
        self.frame = (self.frame + 1) % Self::FRAMES.len();
    }

    pub fn current(&self) -> &str {
        Self::FRAMES[self.frame]
    }
}

pub struct HelpText {
    pub shortcuts: Vec<(String, String)>,
    pub style: Style,
}

impl HelpText {
    pub fn render(&self) -> Line<'_> {
        let mut spans = Vec::new();

        for (i, (key, desc)) in self.shortcuts.iter().enumerate() {
            if i > 0 {
                spans.push(Span::raw(" "));
            }
            spans.push(Span::styled(format!("[{}]", key), self.style));
            spans.push(Span::raw(desc));
        }

        Line::from(spans)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spinner_uses_terminal_safe_ascii_frames() {
        let mut spinner = Spinner::new(Style::default());

        for _ in 0..8 {
            assert!(spinner.current().is_ascii());
            spinner.tick();
        }
    }
}
