# Motion And Timing

Use this knowledge when adjusting rhythm, entrances, exits, beats, or transitions.

- Drive every animation with useCurrentFrame() and useVideoConfig(); never with CSS transitions, CSS animations, or animation utility classes.
- Express intent in seconds, then convert with fps: frame = seconds * fps.
- Use interpolate() with explicit input/output ranges and Easing (for example Easing.bezier) for shaped motion.
- Use extrapolateLeft and extrapolateRight set to "clamp" to avoid values running past the intended range.
- Structure time with Sequence and Series. Inside a Sequence, useCurrentFrame() returns a local frame, not the global composition frame.
- Derive several properties from one timing progress value instead of repeating separate curves.
- Keep premountFor and offsets conservative unless the user asks to change pacing.

Output should state the target frame or time range, the global-vs-local frame distinction when relevant, and which frames to validate (start, middle, end for motion).
