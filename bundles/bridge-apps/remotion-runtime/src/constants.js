const IGNORED_DIRS = new Set([".git", "node_modules", "out", "dist", "build", ".next", ".sparo_os", "coverage"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const PREVIEW_CACHE_LIMIT = 160;
const PREVIEW_VIDEO_CACHE_LIMIT = 24;
const DEFAULT_PREVIEW_SCALE = 1;
const DEFAULT_PREVIEW_VIDEO_SCALE = 0.5;
const DEFAULT_PREVIEW_CLIP_SECONDS = 3;
const DEFAULT_STILL_SCALE = 1;
const REMOTION_RENDER_TIMEOUT_MS = 240_000;
const REMOTION_EXPORT_TIMEOUT_MS = 600_000;
const PREVIEW_SERVER_BOOT_WAIT_MS = 0;
const PREVIEW_SERVER_STALE_MS = 120_000;
const PLAYER_HOST_BOOT_WAIT_MS = 45_000;
const PLAYER_HOST_STALE_MS = 10 * 60_000;
const PLAYER_HOST_RUNTIME_VERSION = 7;
const ASSET_EXTENSIONS = new Map([
  [".png", "image"],
  [".jpg", "image"],
  [".jpeg", "image"],
  [".webp", "image"],
  [".gif", "image"],
  [".svg", "image"],
  [".mp4", "video"],
  [".mov", "video"],
  [".webm", "video"],
  [".m4v", "video"],
  [".mp3", "audio"],
  [".wav", "audio"],
  [".m4a", "audio"],
  [".ogg", "audio"],
  [".aac", "audio"],
  [".ttf", "font"],
  [".otf", "font"],
  [".woff", "font"],
  [".woff2", "font"],
  [".srt", "caption"],
  [".vtt", "caption"],
  [".json", "data"],
]);

module.exports = {
  IGNORED_DIRS,
  SOURCE_EXTENSIONS,
  PREVIEW_CACHE_LIMIT,
  PREVIEW_VIDEO_CACHE_LIMIT,
  DEFAULT_PREVIEW_SCALE,
  DEFAULT_PREVIEW_VIDEO_SCALE,
  DEFAULT_PREVIEW_CLIP_SECONDS,
  DEFAULT_STILL_SCALE,
  REMOTION_RENDER_TIMEOUT_MS,
  REMOTION_EXPORT_TIMEOUT_MS,
  PREVIEW_SERVER_BOOT_WAIT_MS,
  PREVIEW_SERVER_STALE_MS,
  PLAYER_HOST_BOOT_WAIT_MS,
  PLAYER_HOST_STALE_MS,
  PLAYER_HOST_RUNTIME_VERSION,
  ASSET_EXTENSIONS,
};
