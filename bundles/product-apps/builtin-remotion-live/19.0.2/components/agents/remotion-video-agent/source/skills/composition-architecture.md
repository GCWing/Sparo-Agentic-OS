# Composition Architecture

Use this knowledge when adding, splitting, or restructuring compositions and their components.

- A Composition declares the renderable unit: id, width, height, fps, durationInFrames, and component.
- Keep root registration (registerRoot, RemotionRoot) clear and stable.
- Treat width, height, fps, and durationInFrames as a contract. Do not silently change them; a change there is a global change.
- Prefer typed defaultProps and a stable props shape over ad hoc inline values.
- Use calculateMetadata for dynamic duration or size instead of hardcoding when the source already drives it from data.
- Split a large component by visual responsibility (scene, layer, overlay), not by arbitrary line count.

Output should name the target composition, the component or props to change, and whether the change touches the composition contract (id/fps/size/duration) so it can be flagged as high risk.
