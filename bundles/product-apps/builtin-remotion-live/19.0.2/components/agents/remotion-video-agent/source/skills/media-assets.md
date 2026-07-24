# Media And Assets

Use this knowledge when working with images, video, audio, fonts, captions, or data assets.

- Reference public assets with staticFile() rather than absolute filesystem paths or bare relative URLs.
- Use Remotion media primitives: Img for images, OffthreadVideo or Video for video, Audio for sound.
- Control media with Remotion props: trimBefore/trimAfter (or startFrom/endAt), volume, and playbackRate, so media stays frame-accurate.
- Keep media deterministic for render: avoid network-only sources that may fail headless rendering.
- When replacing an asset, reuse the existing asset path convention in public/ and keep references consistent.
- For data-driven video, load data as a typed prop or staticFile JSON, not from a live network call during render.

Output should name the asset reference being changed, confirm it resolves through staticFile() or an existing managed path, and note any media timing implications.
