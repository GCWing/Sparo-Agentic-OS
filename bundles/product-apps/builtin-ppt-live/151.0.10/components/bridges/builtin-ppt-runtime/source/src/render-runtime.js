const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Resvg, initWasm } = require("./vendor/resvg/index.js");

let initialization;
let fontBuffers;

function existingFiles(candidates) {
  return candidates.filter((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

function discoverFonts() {
  if (fontBuffers) return fontBuffers;
  const platform = os.platform();
  const candidates = platform === "win32"
    ? [
        "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/msyhbd.ttc",
      ]
    : platform === "darwin"
      ? [
          "/System/Library/Fonts/Helvetica.ttc",
          "/System/Library/Fonts/PingFang.ttc",
          "/System/Library/Fonts/SFNS.ttf",
        ]
      : [
          "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
          "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
          "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
          "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
        ];
  fontBuffers = existingFiles(candidates).map((filePath) => new Uint8Array(fs.readFileSync(filePath)));
  return fontBuffers;
}

async function ensureInitialized() {
  if (!initialization) {
    const wasmPath = path.join(__dirname, "vendor", "resvg", "index_bg.wasm");
    initialization = initWasm(fs.readFileSync(wasmPath));
  }
  await initialization;
}

async function renderSvg(svg, width = 1600) {
  await ensureInitialized();
  const fonts = discoverFonts();
  const options = {
    fitTo: { mode: "width", value: width },
    font: fonts.length
      ? { fontBuffers: fonts, defaultFontFamily: os.platform() === "win32" ? "Microsoft YaHei" : "Noto Sans CJK SC" }
      : undefined,
  };
  const rendered = new Resvg(svg, options).render();
  return {
    width: rendered.width,
    height: rendered.height,
    png: Buffer.from(rendered.asPng()),
    pixels: Buffer.from(rendered.pixels),
  };
}

function pngDataUri(buffer) {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function renderContactSheet(slides, options = {}) {
  const columns = Math.min(3, Math.max(1, Number(options.columns) || 3));
  const thumbWidth = Number(options.thumbWidth) || 480;
  const thumbHeight = thumbWidth * 9 / 16;
  const gap = 36;
  const labelHeight = 42;
  const rows = Math.ceil(slides.length / columns);
  const width = columns * thumbWidth + (columns + 1) * gap;
  const height = rows * (thumbHeight + labelHeight) + (rows + 1) * gap;
  const background = options.background || "#E9EAED";
  const items = slides.map((slide, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = gap + column * (thumbWidth + gap);
    const y = gap + row * (thumbHeight + labelHeight + gap);
    return `<rect x="${x}" y="${y}" width="${thumbWidth}" height="${thumbHeight}" rx="5" fill="#FFFFFF"/><image x="${x}" y="${y}" width="${thumbWidth}" height="${thumbHeight}" href="${pngDataUri(slide.png)}" preserveAspectRatio="xMidYMid meet"/><text x="${x}" y="${y + thumbHeight + 28}" font-family="Arial, sans-serif" font-size="18" font-weight="600" fill="#20242B">${escapeXml(`${index + 1}. ${slide.title}`)}</text>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${background}"/>${items}</svg>`;
  return renderSvg(svg, width);
}

module.exports = { renderContactSheet, renderSvg };
