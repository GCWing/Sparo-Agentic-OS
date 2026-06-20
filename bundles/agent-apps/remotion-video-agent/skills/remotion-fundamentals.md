# Remotion Fundamentals

Use this knowledge when identifying project structure or explaining how a Remotion video is assembled.

- Treat a Composition as the renderable unit.
- Treat frames as the source of truth for time.
- Keep width, height, fps, and duration explicit.
- Prefer deterministic props and render paths.
- Use staticFile for public assets that must render reliably.
- Avoid browser-only state, current time, random values, and network-only assets in rendered output.

Output should name the composition, entry point, likely source file, and the video consequence of any proposed change.
