//! Window management. Split out from `theme.rs` so theming is purely about
//! colors / init scripts and window creation is purely about window geometry,
//! lifecycle, and platform-specific decorations.

pub mod companion_window;
pub mod main_window;
