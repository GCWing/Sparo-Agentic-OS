/**
 * Minimal XLSX / CSV / JSON workbook I/O using only Node builtins.
 * ZIP: local file header reader + inflateRaw for deflated entries.
 * WRITE: store-method ZIP with a minimal OOXML package openable in Excel.
 */

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const {
  MAX_CSV_PARSED_CELLS,
  parseCsv,
  serializeCsv,
} = require("./csv-io");
const {
  WORKBOOK_SCHEMA_VERSION,
  createEmpty,
  createEmptySheet,
  defaultSheetLayout,
  cellKey,
  newId,
  nowIso,
  defaultFidelity,
  defaultCalculationStatus,
  formatFromPath,
  normalizeWorkbook,
  validateExcelSheetName,
} = require("./workbook-store");
const {
  EXCEL_MAX_COLUMNS,
  EXCEL_MAX_ROWS,
  assertCellCoordinates,
  assertSheetDimensions,
  cellCount,
  indexToCol,
} = require("./a1");

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const MAX_ZIP_ENTRIES = 4096;
const MAX_ZIP_FILE_BYTES = 256 * 1024 * 1024;
const MAX_ZIP_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_ZIP_COMPRESSION_RATIO = 200;
const MAX_CSV_FILE_BYTES = 64 * 1024 * 1024;
const MAX_JSON_FILE_BYTES = 64 * 1024 * 1024;
const MAX_XLSX_PARSED_CELLS = 500_000;
const MAX_DENSE_EXPORT_CELLS = 1_000_000;
const MAX_COMPLEX_FORMULA_COVERAGE_CELLS = 500_000;
const MAX_AUTHORED_CELL_STYLES = 10_000;

function fileFingerprint(buffer, stat) {
  return {
    algorithm: "sha256",
    hash: crypto.createHash("sha256").update(buffer).digest("hex"),
    size: buffer.length,
    mtimeMs: Number(stat.mtimeMs),
  };
}

function readStableFile(filePath, options = {}) {
  const maxBytes = options.maxBytes ?? MAX_ZIP_FILE_BYTES;
  const sizeLimitCode = options.sizeLimitCode || "ZIP_FILE_SIZE_LIMIT";
  const fileKind = options.fileKind || "Workbook file";
  const before = fs.statSync(filePath);
  if (!before.isFile()) throw new Error(`Not a regular file: ${filePath}`);
  if (before.size > maxBytes) {
    throw new Error(
      `[${sizeLimitCode}] ${fileKind} is ${before.size} bytes; maximum is ${maxBytes}.`
    );
  }
  const buffer = fs.readFileSync(filePath);
  const after = fs.statSync(filePath);
  if (
    before.size !== after.size ||
    Number(before.mtimeMs) !== Number(after.mtimeMs) ||
    buffer.length !== after.size
  ) {
    throw new Error(
      `[SOURCE_CHANGED_DURING_READ] ${filePath} changed while it was being read. Retry after external writes finish.`
    );
  }
  return { buffer, fingerprint: fileFingerprint(buffer, after) };
}

function fingerprintsEqual(left, right) {
  return Boolean(
    left &&
      right &&
      left.algorithm === "sha256" &&
      right.algorithm === "sha256" &&
      left.hash === right.hash &&
      left.size === right.size &&
      Number(left.mtimeMs) === Number(right.mtimeMs)
  );
}

function realpathNative(filePath) {
  return fs.realpathSync.native ? fs.realpathSync.native(filePath) : fs.realpathSync(filePath);
}

function identityPathKey(filePath) {
  const normalized = path.normalize(path.resolve(filePath));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function sameFileIdentity(leftPath, rightPath) {
  const left = fs.statSync(leftPath, { bigint: true });
  const right = fs.statSync(rightPath, { bigint: true });
  return left.ino !== 0n && left.dev === right.dev && left.ino === right.ino;
}

/**
 * Resolve the target parent before writing and reject every known alias of the
 * imported source (direct path, symlink/junction path, or existing hard link).
 * The returned path keeps the requested basename but anchors the write in the
 * already-resolved parent directory, so a parent alias is not followed again.
 */
function assertDistinctSourceTarget(sourcePath, targetPath) {
  try {
    const sourceRealPath = realpathNative(sourcePath);
    const targetAbsolutePath = path.resolve(targetPath);
    const targetParentRealPath = realpathNative(path.dirname(targetAbsolutePath));
    const resolvedTargetPath = path.join(targetParentRealPath, path.basename(targetAbsolutePath));
    let targetRealPath = null;
    let targetExists = false;
    try {
      targetRealPath = realpathNative(targetAbsolutePath);
      targetExists = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    const aliasesSource =
      identityPathKey(sourceRealPath) === identityPathKey(resolvedTargetPath) ||
      (targetRealPath != null &&
        identityPathKey(sourceRealPath) === identityPathKey(targetRealPath)) ||
      (targetExists && sameFileIdentity(sourceRealPath, targetAbsolutePath));
    if (aliasesSource) {
      throw new Error(
        `[SOURCE_TARGET_ALIAS_BLOCKED] Export target ${targetPath} resolves to or identifies the imported source package. Choose a different output file.`
      );
    }
    return resolvedTargetPath;
  } catch (error) {
    if (/^\[SOURCE_TARGET_ALIAS_BLOCKED\]/.test(String(error.message || ""))) throw error;
    throw new Error(
      `[SOURCE_TARGET_IDENTITY_CHECK_FAILED] Could not verify that ${targetPath} is distinct from ${sourcePath}: ${error.message}`
    );
  }
}

function crc32(buf) {
  let crc = 0xffffffff;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      t[i] = c >>> 0;
    }
    return t;
  })());
  const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  for (let i = 0; i < data.length; i += 1) {
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decodeXmlEntities(text) {
  return String(text || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function escapeXml(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Read ZIP local file entries (sufficient for typical xlsx packages).
 * @returns {Map<string, Buffer>}
 */
function unzipBuffer(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const files = new Map();
  if (buf.length > MAX_ZIP_FILE_BYTES) {
    throw new Error(
      `[ZIP_FILE_SIZE_LIMIT] Workbook ZIP is ${buf.length} bytes; maximum is ${MAX_ZIP_FILE_BYTES}.`
    );
  }
  if (buf.length < 22) throw new Error("Corrupt ZIP: file is too small");
  let endOffset = -1;
  const minOffset = Math.max(0, buf.length - 0xffff - 22);
  for (let offset = buf.length - 22; offset >= minOffset; offset -= 1) {
    if (buf.readUInt32LE(offset) === SIG_END) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) {
    throw new Error("Corrupt ZIP: end-of-central-directory record not found");
  }
  const entryCount = buf.readUInt16LE(endOffset + 10);
  const centralOffset = buf.readUInt32LE(endOffset + 16);
  if (entryCount === 0xffff || centralOffset === 0xffffffff) {
    throw new Error("ZIP64 workbooks are not supported");
  }
  if (entryCount > MAX_ZIP_ENTRIES) {
    throw new Error(
      `[ZIP_ENTRY_LIMIT] Workbook ZIP has ${entryCount} entries; maximum is ${MAX_ZIP_ENTRIES}.`
    );
  }
  const entries = [];
  let totalUncompressedSize = 0;
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== SIG_CENTRAL) {
      throw new Error("Corrupt ZIP: invalid central directory entry");
    }
    const flags = buf.readUInt16LE(offset + 8);
    const method = buf.readUInt16LE(offset + 10);
    const expectedCrc = buf.readUInt32LE(offset + 16);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    if (flags & 0x1) throw new Error("Encrypted ZIP entries are not supported");
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLen;
    if (nameEnd + extraLen + commentLen > buf.length) {
      throw new Error("Corrupt ZIP: truncated central directory entry");
    }
    const name = buf.slice(nameStart, nameEnd).toString(flags & 0x800 ? "utf8" : "utf8");
    if (uncompressedSize > MAX_ZIP_ENTRY_BYTES) {
      throw new Error(
        `[ZIP_ENTRY_SIZE_LIMIT] ZIP entry ${name} declares ${uncompressedSize} bytes; maximum is ${MAX_ZIP_ENTRY_BYTES}.`
      );
    }
    totalUncompressedSize += uncompressedSize;
    if (totalUncompressedSize > MAX_ZIP_TOTAL_BYTES) {
      throw new Error(
        `[ZIP_TOTAL_SIZE_LIMIT] Workbook ZIP declares ${totalUncompressedSize} uncompressed bytes; maximum is ${MAX_ZIP_TOTAL_BYTES}.`
      );
    }
    if (
      method === METHOD_DEFLATE &&
      uncompressedSize > 0 &&
      (compressedSize === 0 || uncompressedSize / compressedSize > MAX_ZIP_COMPRESSION_RATIO)
    ) {
      throw new Error(
        `[ZIP_COMPRESSION_RATIO_LIMIT] ZIP entry ${name} exceeds the maximum compression ratio of ${MAX_ZIP_COMPRESSION_RATIO}:1.`
      );
    }
    if (method !== METHOD_STORE && method !== METHOD_DEFLATE) {
      throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);
    }
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== SIG_LOCAL) {
      throw new Error(`Corrupt ZIP: local header missing for ${name}`);
    }
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buf.length) throw new Error(`Corrupt ZIP: truncated entry ${name}`);
    entries.push({
      name,
      method,
      expectedCrc,
      compressedSize,
      uncompressedSize,
      dataStart,
      dataEnd,
    });
    offset = nameEnd + extraLen + commentLen;
  }

  for (const entry of entries) {
    const compressed = buf.slice(entry.dataStart, entry.dataEnd);
    let content;
    if (entry.method === METHOD_STORE) {
      content = compressed;
    } else {
      try {
        content = zlib.inflateRawSync(compressed, {
          maxOutputLength: Math.max(1, entry.uncompressedSize),
        });
      } catch (error) {
        throw new Error(`Failed to inflate ZIP entry ${entry.name}: ${error.message}`);
      }
    }
    if (content.length !== entry.uncompressedSize || crc32(content) !== entry.expectedCrc) {
      throw new Error(`Corrupt ZIP: size or CRC mismatch for ${entry.name}`);
    }
    if (!entry.name.endsWith("/")) {
      files.set(entry.name.replace(/\\/g, "/"), content);
    }
  }

  if (files.size === 0) {
    throw new Error("ZIP archive contained no files");
  }
  return files;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

/**
 * Build a ZIP archive using STORE (no compression) for simplicity and reliability.
 * @param {Array<{ name: string, data: Buffer|string }>} entries
 */
function zipStore(entries) {
  const { dosTime, dosDate } = dosDateTime();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = String(entry.name).replace(/\\/g, "/");
    const nameBuf = Buffer.from(name, "utf8");
    const data = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(entry.data == null ? "" : String(entry.data), "utf8");
    const crc = crc32(data);
    const size = data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(METHOD_STORE, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(METHOD_STORE, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // int attrs
    central.writeUInt32LE(0, 38); // ext attrs
    central.writeUInt32LE(offset, 42);

    localParts.push(local, nameBuf, data);
    centralParts.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_END, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, end]);
}

function parseSharedStrings(xml) {
  const strings = [];
  if (!xml) {
    return strings;
  }
  const text = String(xml);
  // Match each <si>...</si> block
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
  let match;
  while ((match = siRe.exec(text))) {
    const block = match[1];
    const parts = [];
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/gi;
    let tMatch;
    while ((tMatch = tRe.exec(block))) {
      parts.push(decodeXmlEntities(tMatch[1]));
    }
    strings.push(parts.join(""));
  }
  return strings;
}

function parseSheetNames(workbookXml) {
  const names = [];
  if (!workbookXml) {
    return names;
  }
  const re = /<sheet\b[^>]*\bname="([^"]+)"[^>]*>/gi;
  let match;
  while ((match = re.exec(String(workbookXml)))) {
    names.push(decodeXmlEntities(match[1]));
  }
  return names;
}

const BUILTIN_NUMBER_FORMATS = Object.freeze({
  0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00",
  9: "0%", 10: "0.00%", 11: "0.00E+00", 12: "# ?/?", 13: "# ??/??",
  14: "mm-dd-yy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy",
  18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss", 22: "m/d/yy h:mm",
  37: "#,##0 ;(#,##0)", 38: "#,##0 ;[Red](#,##0)", 39: "#,##0.00;(#,##0.00)",
  40: "#,##0.00;[Red](#,##0.00)", 49: "@",
});

function xmlAttribute(attrs, name) {
  const match = String(attrs || "").match(new RegExp(`\\b${name}="([^"]*)"`, "i"));
  return match ? decodeXmlEntities(match[1]) : null;
}

function xmlElements(xml, tag) {
  const elements = [];
  const re = new RegExp(`<${tag}\\b([^>]*?)(?:>([\\s\\S]*?)<\\/${tag}>|\\/\\s*>)`, "gi");
  let match;
  while ((match = re.exec(String(xml || "")))) elements.push({ attrs: match[1] || "", body: match[2] || "" });
  return elements;
}

function rgbToColor(rgb) {
  const value = String(rgb || "").trim().toUpperCase();
  if (/^[0-9A-F]{8}$/.test(value)) return `#${value.slice(2)}`;
  if (/^[0-9A-F]{6}$/.test(value)) return `#${value}`;
  return null;
}

function parseXmlColor(xml) {
  const attrs = String(xml || "").match(/<color\b([^>]*)\/?\s*>/i)?.[1]
    || String(xml || "").match(/<fgColor\b([^>]*)\/?\s*>/i)?.[1]
    || "";
  return rgbToColor(xmlAttribute(attrs, "rgb"));
}

function parseStyles(xml) {
  const text = String(xml || "");
  if (!text) return [];
  const customNumberFormats = new Map();
  for (const item of xmlElements(text.match(/<numFmts\b[^>]*>([\s\S]*?)<\/numFmts>/i)?.[1] || "", "numFmt")) {
    const id = Number(xmlAttribute(item.attrs, "numFmtId"));
    const code = xmlAttribute(item.attrs, "formatCode");
    if (Number.isSafeInteger(id) && code) customNumberFormats.set(id, code);
  }
  const fonts = xmlElements(text.match(/<fonts\b[^>]*>([\s\S]*?)<\/fonts>/i)?.[1] || "", "font").map((item) => {
    const font = {};
    if (/<b\b/i.test(item.body)) font.bold = true;
    if (/<i\b/i.test(item.body)) font.italic = true;
    const color = parseXmlColor(item.body);
    if (color) font.color = color;
    const size = Number(item.body.match(/<sz\b[^>]*\bval="([^"]+)"/i)?.[1]);
    if (Number.isFinite(size) && size > 0) font.size = size;
    return Object.keys(font).length ? font : null;
  });
  const fills = xmlElements(text.match(/<fills\b[^>]*>([\s\S]*?)<\/fills>/i)?.[1] || "", "fill").map((item) => {
    const color = parseXmlColor(item.body);
    return color ? { color } : null;
  });
  const borders = xmlElements(text.match(/<borders\b[^>]*>([\s\S]*?)<\/borders>/i)?.[1] || "", "border").map((item) => {
    const border = {};
    for (const side of ["top", "right", "bottom", "left"]) {
      const match = item.body.match(new RegExp(`<${side}\\b([^>]*?)(?:>([\\s\\S]*?)<\\/${side}>|\\/\\s*>)`, "i"));
      if (!match) continue;
      const style = xmlAttribute(match[1], "style");
      if (!style) continue;
      border[side] = { style };
      const color = parseXmlColor(match[2]);
      if (color) border[side].color = color;
    }
    return Object.keys(border).length ? border : null;
  });
  const cellXfs = text.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/i)?.[1] || "";
  return xmlElements(cellXfs, "xf").map((xf) => {
    const style = {};
    const fontId = Number(xmlAttribute(xf.attrs, "fontId"));
    const fillId = Number(xmlAttribute(xf.attrs, "fillId"));
    const borderId = Number(xmlAttribute(xf.attrs, "borderId"));
    const numFmtId = Number(xmlAttribute(xf.attrs, "numFmtId"));
    if (fonts[fontId]) style.font = fonts[fontId];
    if (fills[fillId]) style.fill = fills[fillId];
    if (borders[borderId]) style.border = borders[borderId];
    const numberFormat = customNumberFormats.get(numFmtId) || BUILTIN_NUMBER_FORMATS[numFmtId];
    if (numberFormat && numFmtId !== 0) style.numberFormat = numberFormat;
    const alignmentAttrs = xf.body.match(/<alignment\b([^>]*)\/?\s*>/i)?.[1];
    if (alignmentAttrs != null) {
      const alignment = {};
      const horizontal = xmlAttribute(alignmentAttrs, "horizontal");
      const vertical = xmlAttribute(alignmentAttrs, "vertical");
      if (horizontal) alignment.horizontal = horizontal;
      if (vertical) alignment.vertical = vertical;
      if (xmlAttribute(alignmentAttrs, "wrapText") === "1") alignment.wrapText = true;
      if (Object.keys(alignment).length) style.alignment = alignment;
    }
    return Object.keys(style).length ? style : null;
  });
}

function parseWorksheetLayout(xml) {
  const text = String(xml || "");
  const columns = [];
  const colsBody = text.match(/<cols\b[^>]*>([\s\S]*?)<\/cols>/i)?.[1] || "";
  for (const column of xmlElements(colsBody, "col")) {
    const start = Number(xmlAttribute(column.attrs, "min")) - 1;
    const end = Number(xmlAttribute(column.attrs, "max")) - 1;
    const width = Number(xmlAttribute(column.attrs, "width"));
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) continue;
    const band = { start, end };
    if (Number.isFinite(width) && width > 0) band.width = width;
    if (xmlAttribute(column.attrs, "bestFit") === "1") band.autoFit = true;
    if (band.width != null || band.autoFit) columns.push(band);
  }
  const rows = [];
  const rowRe = /<row\b([^>]*?)(?:>[\s\S]*?<\/row>|\/\s*>)/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(text))) {
    const row = Number(xmlAttribute(rowMatch[1], "r")) - 1;
    const height = Number(xmlAttribute(rowMatch[1], "ht"));
    if (!Number.isSafeInteger(row) || row < 0) continue;
    if (Number.isFinite(height) && height > 0) rows.push({ start: row, end: row, height });
  }
  const paneAttrs = text.match(/<pane\b([^>]*)\/?\s*>/i)?.[1] || "";
  const paneState = xmlAttribute(paneAttrs, "state");
  const freezePanes = {
    rows: paneState && paneState.toLowerCase().startsWith("frozen") ? Math.max(0, Number(xmlAttribute(paneAttrs, "ySplit")) || 0) : 0,
    columns: paneState && paneState.toLowerCase().startsWith("frozen") ? Math.max(0, Number(xmlAttribute(paneAttrs, "xSplit")) || 0) : 0,
  };
  const filterRef = text.match(/<autoFilter\b[^>]*\bref="([^"]+)"/i)?.[1] || null;
  return {
    units: { columnWidth: "excelCharacters", rowHeight: "points" },
    columns,
    rows,
    freezePanes,
    autoFilter: filterRef ? { a1: decodeXmlEntities(filterRef).replaceAll("$", "") } : null,
  };
}

function parseWorkbookSheetRefs(workbookXml) {
  const sheets = [];
  const re = /<sheet\b([^>]*)\/?\s*>/gi;
  let match;
  while ((match = re.exec(String(workbookXml || "")))) {
    const attrs = match[1] || "";
    const nameMatch = attrs.match(/\bname="([^"]+)"/i);
    const relMatch = attrs.match(/\br:id="([^"]+)"/i);
    if (nameMatch && relMatch) {
      sheets.push({ name: decodeXmlEntities(nameMatch[1]), relId: relMatch[1] });
    }
  }
  return sheets;
}

function parseRelationships(xml) {
  const relationships = new Map();
  const re = /<Relationship\b([^>]*)\/?\s*>/gi;
  let match;
  while ((match = re.exec(String(xml || "")))) {
    const attrs = match[1] || "";
    const id = attrs.match(/\bId="([^"]+)"/i)?.[1];
    const target = attrs.match(/\bTarget="([^"]+)"/i)?.[1];
    const type = attrs.match(/\bType="([^"]+)"/i)?.[1] || "";
    if (id && target) relationships.set(id, { target: decodeXmlEntities(target), type });
  }
  return relationships;
}

function resolveWorkbookTarget(target) {
  const normalized = String(target || "").replaceAll("\\", "/");
  if (normalized.startsWith("/")) return normalized.slice(1);
  if (normalized.startsWith("xl/")) return path.posix.normalize(normalized);
  return path.posix.normalize(path.posix.join("xl", normalized));
}

function parseCellRef(ref) {
  const normalized = String(ref || "").toUpperCase();
  const match = normalized.match(/^([A-Z]+)([1-9]\d*)$/);
  if (!match) {
    throw new Error(
      `[XLSX_CELL_REF_INVALID] Worksheet contains an invalid cell reference: ${JSON.stringify(ref)}.`
    );
  }
  if (match[1].length > 3 || match[2].length > 7) {
    throw new Error(
      `[XLSX_CELL_REF_LIMIT] Cell reference ${normalized} exceeds Excel's maximum of ${EXCEL_MAX_ROWS} rows and ${EXCEL_MAX_COLUMNS} columns (XFD).`
    );
  }
  const rowNumber = Number(match[2]);
  if (!Number.isSafeInteger(rowNumber) || rowNumber < 1 || rowNumber > EXCEL_MAX_ROWS) {
    throw new Error(
      `[XLSX_CELL_REF_LIMIT] Cell reference ${normalized} exceeds Excel's maximum of ${EXCEL_MAX_ROWS} rows.`
    );
  }
  let columnNumber = 0;
  for (const character of match[1]) {
    columnNumber = columnNumber * 26 + character.charCodeAt(0) - 64;
    if (!Number.isSafeInteger(columnNumber) || columnNumber > EXCEL_MAX_COLUMNS) {
      throw new Error(
        `[XLSX_CELL_REF_LIMIT] Cell reference ${normalized} exceeds Excel's maximum of ${EXCEL_MAX_COLUMNS} columns (XFD).`
      );
    }
  }
  return {
    c: columnNumber - 1,
    r: rowNumber - 1,
  };
}

function assertZeroBasedCellCoordinates(row, column, context) {
  try {
    assertCellCoordinates(row, column, context);
  } catch (_error) {
    throw new Error(
      `[XLSX_CELL_REF_LIMIT] ${context} must use safe integer coordinates within rows 0-${EXCEL_MAX_ROWS - 1} and columns 0-${EXCEL_MAX_COLUMNS - 1}.`
    );
  }
}

function createCellParseBudget() {
  return { parsed: 0, limit: MAX_XLSX_PARSED_CELLS };
}

function consumeCellParseBudget(budget) {
  budget.parsed += 1;
  if (!Number.isSafeInteger(budget.parsed) || budget.parsed > budget.limit) {
    throw new Error(
      `[XLSX_CELL_COUNT_LIMIT] Workbook contains more than ${budget.limit} serialized cell records.`
    );
  }
}

function formulaAttribute(attrs, name) {
  return String(attrs || "").match(
    new RegExp(`\\b${name}="([^"]*)"`, "i")
  )?.[1] || null;
}

function parseFormulaRangeRef(ref, formulaType, anchor) {
  const normalized = String(ref || "").replaceAll("$", "").trim();
  if (!normalized) {
    return {
      type: formulaType,
      ref: null,
      r1: anchor.r,
      c1: anchor.c,
      r2: anchor.r,
      c2: anchor.c,
    };
  }
  const parts = normalized.split(":");
  if (parts.length < 1 || parts.length > 2) {
    throw new Error(
      `[COMPLEX_FORMULA_REF_INVALID] Invalid ${formulaType} formula range: ${ref}`
    );
  }
  const start = parseCellRef(parts[0]);
  const end = parseCellRef(parts[1] || parts[0]);
  return {
    type: formulaType,
    ref: normalized,
    r1: Math.min(start.r, end.r),
    c1: Math.min(start.c, end.c),
    r2: Math.max(start.r, end.r),
    c2: Math.max(start.c, end.c),
  };
}

function applyComplexFormulaEvidence(cells, ranges) {
  let coveredCellCount = 0;
  for (const range of ranges) {
    coveredCellCount += cellCount(range.r1, range.c1, range.r2, range.c2);
    if (coveredCellCount > MAX_COMPLEX_FORMULA_COVERAGE_CELLS) {
      throw new Error(
        `[COMPLEX_FORMULA_COVERAGE_LIMIT] Complex formula ranges cover more than ${MAX_COMPLEX_FORMULA_COVERAGE_CELLS} cells.`
      );
    }
  }
  for (const range of ranges) {
    for (let r = range.r1; r <= range.r2; r += 1) {
      for (let c = range.c1; c <= range.c2; c += 1) {
        const cell = cells[cellKey(r, c)];
        if (!cell) continue;
        cell.formulaEvidence = true;
        cell.formulaGroupType = range.type;
        if (range.ref) cell.formulaGroupRef = range.ref;
      }
    }
  }
}

function parseWorksheet(xml, sharedStrings, budget = createCellParseBudget(), styles = []) {
  const cells = {};
  const complexFormulaRanges = [];
  const layout = parseWorksheetLayout(xml);
  let maxR = 0;
  let maxC = 0;
  if (!xml) {
    return { cells, rows: 50, cols: 26, complexFormulaRanges, layout };
  }
  const text = String(xml);
  const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/gi;
  let match;
  while ((match = cellRe.exec(text))) {
    consumeCellParseBudget(budget);
    const attrs = match[1] || match[3] || "";
    const body = match[2] || "";
    const refMatch = attrs.match(/\br="([^"]+)"/i);
    if (!refMatch) {
      throw new Error(
        "[XLSX_CELL_REF_INVALID] Worksheet contains a cell record without an explicit r coordinate."
      );
    }
    const pos = parseCellRef(refMatch[1]);
    const typeMatch = attrs.match(/\bt="([^"]+)"/i);
    const cellType = typeMatch ? typeMatch[1] : null;
    const styleIndex = Number(attrs.match(/\bs="([^"]+)"/i)?.[1]);
    const formulaMatch = body.match(/<f\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/f>)/i);
    const valueMatch = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i);
    const isMatch = body.match(/<is\b[^>]*>([\s\S]*?)<\/is>/i);

    const cell = {};
    if (formulaMatch) {
      const formulaAttrs = formulaMatch[1] || "";
      const formulaText = decodeXmlEntities(formulaMatch[2] || "");
      const formulaType = String(formulaAttribute(formulaAttrs, "t") || "normal").toLowerCase();
      const formulaRef = formulaAttribute(formulaAttrs, "ref");
      cell.formulaEvidence = true;
      if (formulaText) cell.f = formulaText;
      if (formulaType !== "normal") cell.formulaType = formulaType;
      if (formulaRef) cell.formulaRef = formulaRef;
      if (["shared", "array", "datatable"].includes(formulaType)) {
        const range = parseFormulaRangeRef(formulaRef, formulaType, pos);
        // Shared followers normally omit ref; the shared master contributes
        // the authoritative group range. Keep a single-cell fallback only so
        // an isolated complex formula is still protected.
        if (formulaRef || formulaType !== "shared") {
          complexFormulaRanges.push(range);
        }
      }
    }
    if (isMatch) {
      const parts = [];
      const textRe = /<t\b[^>]*>([\s\S]*?)<\/t>/gi;
      let textMatch;
      while ((textMatch = textRe.exec(isMatch[1]))) {
        parts.push(decodeXmlEntities(textMatch[1]));
      }
      cell.v = parts.join("");
      cell.t = "s";
    } else if (valueMatch) {
      const raw = decodeXmlEntities(valueMatch[1]);
      if (cellType === "s") {
        const idx = Number(raw);
        cell.v = Number.isFinite(idx) && sharedStrings[idx] != null
          ? sharedStrings[idx]
          : raw;
        cell.t = "s";
      } else if (cellType === "b") {
        cell.v = raw === "1" || raw === "true";
        cell.t = "b";
      } else if (cellType === "str" || cellType === "inlineStr") {
        cell.v = raw;
        cell.t = "s";
      } else if (raw !== "" && !Number.isNaN(Number(raw)) && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(raw)) {
        cell.v = Number(raw);
        cell.t = "n";
      } else {
        cell.v = raw;
        cell.t = cellType || "s";
      }
    } else if (cell.formulaEvidence) {
      cell.t = "f";
    } else if (!Number.isSafeInteger(styleIndex)) {
      continue;
    }

    if (Number.isSafeInteger(styleIndex) && styleIndex >= 0) {
      cell._sourceStyleIndex = styleIndex;
      if (styles[styleIndex]) cell.style = JSON.parse(JSON.stringify(styles[styleIndex]));
    }

    cells[cellKey(pos.r, pos.c)] = cell;
    if (pos.r > maxR) maxR = pos.r;
    if (pos.c > maxC) maxC = pos.c;
  }

  applyComplexFormulaEvidence(cells, complexFormulaRanges);

  return {
    cells,
    rows: Math.max(50, maxR + 1),
    cols: Math.max(26, maxC + 1),
    complexFormulaRanges,
    layout,
  };
}

function listSheetXmlPaths(files) {
  const paths = [];
  for (const name of files.keys()) {
    const m = name.match(/^xl\/worksheets\/sheet(\d+)\.xml$/i);
    if (m) {
      paths.push({ name, index: Number(m[1]) });
    }
  }
  paths.sort((a, b) => a.index - b.index);
  return paths.map((p) => p.name);
}

function workbookSheetDescriptors(files) {
  const workbookXml = (files.get("xl/workbook.xml") || Buffer.alloc(0)).toString("utf8");
  const relsXml = (files.get("xl/_rels/workbook.xml.rels") || Buffer.alloc(0)).toString("utf8");
  const refs = parseWorkbookSheetRefs(workbookXml);
  const relationships = parseRelationships(relsXml);
  const descriptors = refs
    .map((ref) => {
      const relation = relationships.get(ref.relId);
      if (!relation || (relation.type && !relation.type.toLowerCase().endsWith("/worksheet"))) {
        return null;
      }
      return { name: ref.name, path: resolveWorkbookTarget(relation.target) };
    })
    .filter(Boolean)
    .filter((sheet) => files.has(sheet.path));
  if (descriptors.length > 0) return descriptors;
  const names = parseSheetNames(workbookXml);
  return listSheetXmlPaths(files).map((sheetPath, index) => ({
    name: names[index] || `Sheet${index + 1}`,
    path: sheetPath,
  }));
}

function calculationStatusWithFormulaEvidence(sheets) {
  let formulaCount = 0;
  for (const sheet of sheets || []) {
    for (const cell of Object.values(sheet.cells || {})) {
      if (cell && (cell.formulaEvidence === true || (typeof cell.f === "string" && cell.f))) {
        formulaCount += 1;
      }
    }
  }
  if (formulaCount === 0) return defaultCalculationStatus(sheets);
  return {
    engine: "none",
    status: "cached",
    formulaCount,
    lastCalculatedRevision: null,
    warning: "Formula results are cached values; this engine does not recalculate formulas.",
  };
}

function assertWorkbookShapeLimits(workbook) {
  let serializedCellCount = 0;
  const sheetNames = new Set();
  for (const [index, sheet] of (workbook?.sheets || []).entries()) {
    const sheetName = validateExcelSheetName(sheet.name || `Sheet${index + 1}`);
    const sheetKey = sheetName.toLowerCase();
    if (sheetNames.has(sheetKey)) throw new Error(`[DUPLICATE_SHEET_NAME] Worksheet name already exists: ${sheetName}`);
    sheetNames.add(sheetKey);
    assertSheetDimensions(Number(sheet.rows), Number(sheet.cols), `Worksheet ${index + 1}`);
    for (const key of Object.keys(sheet.cells || {})) {
      serializedCellCount += 1;
      if (serializedCellCount > MAX_XLSX_PARSED_CELLS) {
        throw new Error(
          `[XLSX_CELL_COUNT_LIMIT] Workbook contains more than ${MAX_XLSX_PARSED_CELLS} cell records.`
        );
      }
      const parts = key.split(",");
      if (parts.length !== 2) {
        throw new Error(`[XLSX_CELL_REF_INVALID] Invalid workbook cell key: ${key}`);
      }
      assertZeroBasedCellCoordinates(
        Number(parts[0]),
        Number(parts[1]),
        `Workbook cell key ${JSON.stringify(key)}`
      );
    }
  }
  return workbook;
}

function workbookFromSheets(sheets, options = {}) {
  const createdAt = nowIso();
  const normalized = sheets.map((sheet, index) => {
    const rows = sheet.rows || 50;
    const cols = sheet.cols || 26;
    assertSheetDimensions(rows, cols, `Worksheet ${index + 1}`);
    return {
      id: sheet.id || newId("sheet"),
      name: sheet.name || `Sheet${index + 1}`,
      rows,
      cols,
      cells: sheet.cells || {},
      layout: sheet.layout || defaultSheetLayout(),
      complexFormulaRanges: Array.isArray(sheet.complexFormulaRanges)
        ? sheet.complexFormulaRanges
        : [],
    };
  });
  if (normalized.length === 0) {
    normalized.push(createEmptySheet("Sheet1"));
  }
  const sourcePath = options.path || null;
  const sourceFormat = formatFromPath(sourcePath);
  return assertWorkbookShapeLimits({
    schemaVersion: WORKBOOK_SCHEMA_VERSION,
    workbookId: options.workbookId || newId("wb"),
    path: sourcePath,
    sourcePath,
    sourceFormat,
    sourceFingerprint: options.sourceFingerprint || null,
    lastExportPath: null,
    lastExportedRevision: null,
    title: options.title || path.basename(options.path || "Workbook", path.extname(options.path || "")) || "Workbook",
    sheets: normalized,
    activeSheetId: normalized[0].id,
    dirty: false,
    revision: 0,
    mode: "edit",
    focus: {
      sheetId: normalized[0].id,
      a1: "A1",
      kind: "cell",
    },
    proposal: null,
    fidelity: defaultFidelity(sourceFormat),
    calculationStatus: calculationStatusWithFormulaEvidence(normalized),
    history: [],
    undoStack: [],
    redoStack: [],
    createdAt,
    updatedAt: createdAt,
  });
}

function readCsvFile(filePath, options = {}) {
  const text = readStableFile(filePath, {
    maxBytes: MAX_CSV_FILE_BYTES,
    sizeLimitCode: "CSV_FILE_SIZE_LIMIT",
    fileKind: "CSV source file",
  }).buffer.toString("utf8");
  const rows = parseCsv(text, {
    maxRows: EXCEL_MAX_ROWS,
    maxColumns: EXCEL_MAX_COLUMNS,
    maxCells: MAX_CSV_PARSED_CELLS,
  });
  const cells = {};
  let maxCols = 26;
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r] || [];
    if (row.length > maxCols) maxCols = row.length;
    for (let c = 0; c < row.length; c += 1) {
      const value = row[c];
      if (value === "" || value == null) continue;
      const num = Number(value);
      if (value !== "" && !Number.isNaN(num) && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(String(value).trim())) {
        cells[cellKey(r, c)] = { v: num, t: "n" };
      } else {
        cells[cellKey(r, c)] = { v: value, t: "s" };
      }
    }
  }
  const sheet = {
    id: newId("sheet"),
    name: "Sheet1",
    rows: Math.max(50, rows.length),
    cols: Math.max(26, maxCols),
    cells,
  };
  return workbookFromSheets([sheet], {
    path: filePath,
    title: options.title || path.basename(filePath, path.extname(filePath)),
    workbookId: options.workbookId,
  });
}

function readJsonFile(filePath, options = {}) {
  const text = readStableFile(filePath, {
    maxBytes: MAX_JSON_FILE_BYTES,
    sizeLimitCode: "JSON_FILE_SIZE_LIMIT",
    fileKind: "JSON source file",
  }).buffer.toString("utf8");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Failed to parse workbook JSON: ${error.message}`);
  }
  if (parsed && Array.isArray(parsed.sheets)) {
    const wb = createEmpty({
      workbookId: options.workbookId || parsed.workbookId,
      title: options.title || parsed.title,
      path: filePath,
    });
    const imported = normalizeWorkbook({
      ...wb,
      ...parsed,
      path: filePath,
      sourcePath: filePath,
      sourceFormat: "json",
      workbookId: options.workbookId || parsed.workbookId || wb.workbookId,
      dirty: false,
      proposal: parsed.proposal || null,
    });
    imported.fidelity = defaultFidelity("json");
    return assertWorkbookShapeLimits(imported);
  }
  throw new Error("JSON file is not a Sparo workbook store");
}

function readXlsxFile(filePath, options = {}) {
  let snapshot;
  try {
    snapshot = readStableFile(filePath);
  } catch (error) {
    throw new Error(`Failed to read xlsx file: ${error.message}`);
  }
  const buffer = snapshot.buffer;

  let files;
  try {
    files = unzipBuffer(buffer);
  } catch (error) {
    throw new Error(`Failed to parse xlsx as ZIP: ${error.message}`);
  }

  const sharedStrings = parseSharedStrings(
    (files.get("xl/sharedStrings.xml") || Buffer.alloc(0)).toString("utf8")
  );
  const styles = parseStyles(
    (files.get("xl/styles.xml") || Buffer.alloc(0)).toString("utf8")
  );
  const sheetDescriptors = workbookSheetDescriptors(files);
  if (sheetDescriptors.length === 0) {
    throw new Error("xlsx package has no worksheets under xl/worksheets/");
  }

  const cellBudget = createCellParseBudget();
  const sheets = sheetDescriptors.map((descriptor, index) => {
    const xml = files.get(descriptor.path).toString("utf8");
    const parsed = parseWorksheet(xml, sharedStrings, cellBudget, styles);
    return {
      id: newId("sheet"),
      name: descriptor.name || `Sheet${index + 1}`,
      rows: parsed.rows,
      cols: parsed.cols,
      cells: parsed.cells,
      complexFormulaRanges: parsed.complexFormulaRanges,
      layout: parsed.layout,
    };
  });

  const workbook = workbookFromSheets(sheets, {
    path: filePath,
    title: options.title || path.basename(filePath, path.extname(filePath)),
    workbookId: options.workbookId,
    sourceFingerprint: snapshot.fingerprint,
  });
  if ([...files.keys()].some((name) => name.toLowerCase().startsWith("_xmlsignatures/"))) {
    workbook.fidelity.canRoundTrip = false;
    workbook.fidelity.level = "limited";
    workbook.fidelity.warning =
      "This workbook has an OOXML package signature that would be invalidated by editing.";
  }
  return workbook;
}

function readWorkbookFile(filePath, options = {}) {
  if (!filePath) {
    throw new Error("File path is required");
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".csv") {
    return readCsvFile(filePath, options);
  }
  if (ext === ".json") {
    return readJsonFile(filePath, options);
  }
  if (ext === ".xlsx" || ext === ".xlsm") {
    try {
      return readXlsxFile(filePath, options);
    } catch (error) {
      throw new Error(
        `Failed to open xlsx workbook at ${filePath}: ${error.message}. ` +
          "Only simple OOXML sheets (values, shared strings, basic formulas) are supported."
      );
    }
  }
  throw new Error(`Unsupported workbook file type: ${ext || "(none)"}`);
}

function inferCellType(cell) {
  if (!cell) return null;
  if (cell.f) return "f";
  if (cell.t) return cell.t;
  if (typeof cell.v === "number") return "n";
  if (typeof cell.v === "boolean") return "b";
  return "s";
}

function buildSharedStrings(workbook) {
  const list = [];
  const index = new Map();
  function add(str) {
    const key = String(str);
    if (index.has(key)) return index.get(key);
    const i = list.length;
    list.push(key);
    index.set(key, i);
    return i;
  }
  for (const sheet of workbook.sheets) {
    for (const cell of Object.values(sheet.cells || {})) {
      if (!cell) continue;
      if (cell.f) continue;
      const t = inferCellType(cell);
      if (t === "s" || t === "str") {
        add(cell.v == null ? "" : String(cell.v));
      }
    }
  }
  return { list, index };
}

function visualStyle(style) {
  if (!style || typeof style !== "object") return null;
  const { role: _role, ...visual } = style;
  return Object.keys(visual).length ? visual : null;
}

function colorToArgb(color) {
  const value = String(color || "").replace(/^#/, "").toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(value)) throw new Error(`[INVALID_STYLE_COLOR] Expected #RRGGBB, received ${JSON.stringify(color)}.`);
  return `FF${value}`;
}

function createStyleTable(workbook) {
  const fonts = [null];
  const fills = [null, { gray125: true }];
  const borders = [null];
  const numberFormats = [];
  const fontIds = new Map([["null", 0]]);
  const fillIds = new Map([["null", 0]]);
  const borderIds = new Map([["null", 0]]);
  const numberFormatIds = new Map();
  const xfs = [{ fontId: 0, fillId: 0, borderId: 0, numFmtId: 0, alignment: null }];
  const xfIds = new Map([["null", 0]]);

  const componentId = (value, values, ids) => {
    const key = JSON.stringify(value || null);
    if (ids.has(key)) return ids.get(key);
    const id = values.length;
    values.push(value);
    ids.set(key, id);
    return id;
  };
  const numberFormatId = (code) => {
    if (!code) return 0;
    const key = String(code);
    if (numberFormatIds.has(key)) return numberFormatIds.get(key);
    const id = 164 + numberFormats.length;
    numberFormats.push({ id, code: key });
    numberFormatIds.set(key, id);
    return id;
  };
  const register = (style) => {
    const visual = visualStyle(style);
    const key = JSON.stringify(visual || null);
    if (xfIds.has(key)) return xfIds.get(key);
    if (xfs.length >= MAX_AUTHORED_CELL_STYLES) {
      throw new Error(`[XLSX_STYLE_LIMIT] Workbook exceeds ${MAX_AUTHORED_CELL_STYLES} distinct authored cell styles.`);
    }
    const xf = {
      fontId: componentId(visual?.font, fonts, fontIds),
      fillId: componentId(visual?.fill, fills, fillIds),
      borderId: componentId(visual?.border, borders, borderIds),
      numFmtId: numberFormatId(visual?.numberFormat),
      alignment: visual?.alignment || null,
    };
    const id = xfs.length;
    xfs.push(xf);
    xfIds.set(key, id);
    return id;
  };
  for (const sheet of workbook.sheets || []) {
    for (const cell of Object.values(sheet.cells || {})) if (cell?.style) register(cell.style);
  }

  const fontXml = fonts.map((font) => {
    if (!font) return '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>';
    return `<font>${font.bold ? "<b/>" : ""}${font.italic ? "<i/>" : ""}` +
      `<sz val="${escapeXml(String(font.size || 11))}"/><name val="Calibri"/><family val="2"/>` +
      `${font.color ? `<color rgb="${colorToArgb(font.color)}"/>` : ""}</font>`;
  }).join("");
  const fillXml = fills.map((fill) => {
    if (!fill) return '<fill><patternFill patternType="none"/></fill>';
    if (fill.gray125) return '<fill><patternFill patternType="gray125"/></fill>';
    return `<fill><patternFill patternType="solid"><fgColor rgb="${colorToArgb(fill.color)}"/><bgColor indexed="64"/></patternFill></fill>`;
  }).join("");
  const borderXml = borders.map((border) => {
    const sideXml = (side) => {
      const value = border?.[side];
      if (!value) return `<${side}/>`;
      return `<${side} style="${escapeXml(value.style)}">${value.color ? `<color rgb="${colorToArgb(value.color)}"/>` : ""}</${side}>`;
    };
    return `<border>${sideXml("left")}${sideXml("right")}${sideXml("top")}${sideXml("bottom")}<diagonal/></border>`;
  }).join("");
  const xfXml = xfs.map((xf) => {
    const apply = `${xf.numFmtId ? ' applyNumberFormat="1"' : ""}${xf.fontId ? ' applyFont="1"' : ""}${xf.fillId ? ' applyFill="1"' : ""}${xf.borderId ? ' applyBorder="1"' : ""}${xf.alignment ? ' applyAlignment="1"' : ""}`;
    const alignment = xf.alignment
      ? `<alignment${xf.alignment.horizontal ? ` horizontal="${escapeXml(xf.alignment.horizontal)}"` : ""}${xf.alignment.vertical ? ` vertical="${escapeXml(xf.alignment.vertical)}"` : ""}${xf.alignment.wrapText ? ' wrapText="1"' : ""}/>`
      : "";
    return `<xf numFmtId="${xf.numFmtId}" fontId="${xf.fontId}" fillId="${xf.fillId}" borderId="${xf.borderId}" xfId="0"${apply}>${alignment}</xf>`;
  }).join("");
  const numFmtXml = numberFormats.length
    ? `<numFmts count="${numberFormats.length}">${numberFormats.map((item) => `<numFmt numFmtId="${item.id}" formatCode="${escapeXml(item.code)}"/>`).join("")}</numFmts>`
    : "";
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${numFmtXml}` +
    `<fonts count="${fonts.length}">${fontXml}</fonts><fills count="${fills.length}">${fillXml}</fills>` +
    `<borders count="${borders.length}">${borderXml}</borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${xfs.length}">${xfXml}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return { xml, indexFor: register, count: xfs.length };
}

function layoutXml(sheet) {
  const layout = sheet.layout || {};
  const freezeRows = Number(layout.freezePanes?.rows || 0);
  const freezeColumns = Number(layout.freezePanes?.columns || 0);
  const activePane = freezeRows && freezeColumns
    ? "bottomRight"
    : freezeRows
      ? "bottomLeft"
      : "topRight";
  const sheetViews = freezeRows || freezeColumns
    ? `<sheetViews><sheetView workbookViewId="0"><pane${freezeColumns ? ` xSplit="${freezeColumns}"` : ""}${freezeRows ? ` ySplit="${freezeRows}"` : ""} topLeftCell="${indexToCol(freezeColumns)}${freezeRows + 1}" activePane="${activePane}" state="frozen"/></sheetView></sheetViews>`
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const columns = (layout.columns || []).map((band) => {
    const width = band.width == null ? 18 : Number(band.width);
    return `<col min="${band.start + 1}" max="${band.end + 1}" width="${width}"${band.autoFit ? ' bestFit="1"' : ""} customWidth="1"/>`;
  }).join("");
  const cols = columns ? `<cols>${columns}</cols>` : "";
  const autoFilter = layout.autoFilter?.a1 ? `<autoFilter ref="${escapeXml(layout.autoFilter.a1)}"/>` : "";
  return { sheetViews, cols, autoFilter };
}

function sheetToXml(sheet, shared, styleTable) {
  const rowsMap = new Map();
  for (const [key, cell] of Object.entries(sheet.cells || {})) {
    const [rs, cs] = key.split(",");
    const r = Number(rs);
    const c = Number(cs);
    assertZeroBasedCellCoordinates(r, c, `Workbook cell key ${JSON.stringify(key)}`);
    if (!rowsMap.has(r)) rowsMap.set(r, []);
    rowsMap.get(r).push({ c, cell });
  }

  let materializedLayoutRows = 0;
  for (const band of sheet.layout?.rows || []) {
    materializedLayoutRows += band.end - band.start + 1;
    if (materializedLayoutRows > 20_000) {
      throw new Error("[LAYOUT_ROW_LIMIT] XLSX export cannot materialize more than 20000 custom-height rows.");
    }
    for (let row = band.start; row <= band.end; row += 1) if (!rowsMap.has(row)) rowsMap.set(row, []);
  }

  const rowNums = [...rowsMap.keys()].sort((a, b) => a - b);
  const rowXml = [];
  for (const r of rowNums) {
    const cells = rowsMap.get(r).sort((a, b) => a.c - b.c);
    const cellXml = cells.map(({ c, cell }) => {
      const ref = `${indexToCol(c)}${r + 1}`;
      const styleId = cell.style ? styleTable.indexFor(cell.style) : 0;
      const styleAttr = styleId ? ` s="${styleId}"` : "";
      if (cell.f) {
        const f = escapeXml(cell.f);
        const v =
          cell.v != null && cell.v !== ""
            ? `<v>${escapeXml(String(cell.v))}</v>`
            : "";
        return `<c r="${ref}"${styleAttr}><f>${f}</f>${v}</c>`;
      }
      const t = inferCellType(cell);
      if (t === "n") {
        return `<c r="${ref}"${styleAttr}><v>${escapeXml(String(cell.v))}</v></c>`;
      }
      if (t === "b") {
        return `<c r="${ref}"${styleAttr} t="b"><v>${cell.v ? 1 : 0}</v></c>`;
      }
      if (cell.v == null && styleId) return `<c r="${ref}" s="${styleId}"/>`;
      const text = cell.v == null ? "" : String(cell.v);
      const idx = shared.index.has(text)
        ? shared.index.get(text)
        : (() => {
            const i = shared.list.length;
            shared.list.push(text);
            shared.index.set(text, i);
            return i;
          })();
      return `<c r="${ref}"${styleAttr} t="s"><v>${idx}</v></c>`;
    });
    const rowBand = (sheet.layout?.rows || []).find((band) => r >= band.start && r <= band.end);
    const rowAttrs = rowBand
      ? `${rowBand.height != null || rowBand.autoFit ? ` ht="${Number(rowBand.height || 24)}" customHeight="1"` : ""}${rowBand.autoFit ? ' bestFit="1"' : ""}`
      : "";
    rowXml.push(`<row r="${r + 1}"${rowAttrs}>${cellXml.join("")}</row>`);
  }

  const declaredRows = Number(sheet.rows || 1);
  const declaredColumns = Number(sheet.cols || 1);
  assertZeroBasedCellCoordinates(
    declaredRows - 1,
    declaredColumns - 1,
    `Worksheet dimensions ${JSON.stringify({ rows: sheet.rows, cols: sheet.cols })}`
  );
  const dim = `A1:${indexToCol(declaredColumns - 1)}${declaredRows}`;
  const layout = layoutXml(sheet);
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="${dim}"/>` +
    layout.sheetViews +
    layout.cols +
    `<sheetData>${rowXml.join("")}</sheetData>` +
    layout.autoFilter +
    `</worksheet>`
  );
}

function sourceCellsEqual(left, right) {
  const a = left || null;
  const b = right || null;
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.f === b.f &&
    a.v === b.v &&
    Boolean(a.formulaEvidence) === Boolean(b.formulaEvidence) &&
    (a.formulaType || null) === (b.formulaType || null) &&
    (a.formulaRef || null) === (b.formulaRef || null) &&
    (a.formulaGroupType || null) === (b.formulaGroupType || null) &&
    (a.formulaGroupRef || null) === (b.formulaGroupRef || null) &&
    JSON.stringify(a.style || null) === JSON.stringify(b.style || null)
  );
}

function withoutXmlAttribute(attrs, name) {
  return String(attrs || "").replace(
    new RegExp(`\\s\\b${name}="[^"]*"`, "gi"),
    ""
  );
}

function cellAttributes(existingAttrs, ref, type) {
  let rest = withoutXmlAttribute(withoutXmlAttribute(existingAttrs, "r"), "t").trim();
  const parts = [`r="${ref}"`];
  if (rest) parts.push(rest);
  if (type) parts.push(`t="${type}"`);
  return ` ${parts.join(" ")}`;
}

function patchedCellXml(cell, ref, existingAttrs = "") {
  if (!cell) {
    const rest = withoutXmlAttribute(withoutXmlAttribute(existingAttrs, "r"), "t").trim();
    return rest ? `<c r="${ref}" ${rest}/>` : null;
  }
  if (cell.f) {
    let resultType = null;
    if (typeof cell.v === "string") resultType = "str";
    if (typeof cell.v === "boolean") resultType = "b";
    const attrs = cellAttributes(existingAttrs, ref, resultType);
    const value = cell.v == null || cell.v === ""
      ? ""
      : `<v>${escapeXml(typeof cell.v === "boolean" ? (cell.v ? "1" : "0") : String(cell.v))}</v>`;
    return `<c${attrs}><f>${escapeXml(cell.f)}</f>${value}</c>`;
  }
  const type = inferCellType(cell);
  if (type === "n") {
    return `<c${cellAttributes(existingAttrs, ref, null)}><v>${escapeXml(String(cell.v))}</v></c>`;
  }
  if (type === "b") {
    return `<c${cellAttributes(existingAttrs, ref, "b")}><v>${cell.v ? 1 : 0}</v></c>`;
  }
  const text = cell.v == null ? "" : String(cell.v);
  const preserve = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : "";
  return `<c${cellAttributes(existingAttrs, ref, "inlineStr")}><is><t${preserve}>${escapeXml(text)}</t></is></c>`;
}

function parseRowCellTokens(body) {
  const tokens = [];
  const re = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/gi;
  let match;
  while ((match = re.exec(String(body || "")))) {
    const attrs = match[1] || match[3] || "";
    const ref = attrs.match(/\br="([^"]+)"/i)?.[1];
    let col = null;
    if (ref) col = parseCellRef(ref).c;
    tokens.push({
      xml: match[0],
      attrs,
      ref: ref || null,
      col,
      start: match.index,
      end: re.lastIndex,
    });
  }
  return tokens;
}

function patchRowBody(body, changes, row) {
  const source = String(body || "");
  const tokens = parseRowCellTokens(source);
  const existingColumns = new Set(
    tokens.filter((token) => token.col != null).map((token) => token.col)
  );
  const pending = [...changes.entries()]
    .filter(([col]) => !existingColumns.has(col))
    .sort((a, b) => a[0] - b[0]);
  const handled = new Set();
  let pendingIndex = 0;
  let cursor = 0;
  let output = "";

  const appendPendingBefore = (columnLimit = Infinity) => {
    while (pendingIndex < pending.length && pending[pendingIndex][0] < columnLimit) {
      const [col, cell] = pending[pendingIndex];
      const ref = `${indexToCol(col)}${row + 1}`;
      const nextXml = patchedCellXml(cell, ref, "");
      if (nextXml) output += nextXml;
      handled.add(col);
      pendingIndex += 1;
    }
  };

  for (const token of tokens) {
    output += source.slice(cursor, token.start);
    if (token.col != null) appendPendingBefore(token.col);
    if (token.col != null && changes.has(token.col)) {
      const ref = `${indexToCol(token.col)}${row + 1}`;
      const nextXml = patchedCellXml(changes.get(token.col), ref, token.attrs);
      if (nextXml) output += nextXml;
      handled.add(token.col);
    } else {
      output += token.xml;
    }
    cursor = token.end;
  }
  appendPendingBefore();
  output += source.slice(cursor);

  for (const col of changes.keys()) {
    if (!handled.has(col)) {
      throw new Error(`Failed to patch ${indexToCol(col)}${row + 1} in worksheet row XML.`);
    }
  }
  return output;
}

function rowAttributeText(attrs, rowNumber) {
  const rest = withoutXmlAttribute(attrs, "r").trim();
  return rest ? ` r="${rowNumber}" ${rest}` : ` r="${rowNumber}"`;
}

function expandWorksheetDimension(xml, sheet) {
  let usedR = 0;
  let usedC = 0;
  for (const key of Object.keys(sheet.cells || {})) {
    const [r, c] = key.split(",").map(Number);
    assertZeroBasedCellCoordinates(r, c, `Workbook cell key ${JSON.stringify(key)}`);
    usedR = Math.max(usedR, r);
    usedC = Math.max(usedC, c);
  }
  const dimensionMatch = String(xml).match(/<dimension\b([^>]*)\bref="([^"]+)"([^>]*)\/>/i);
  if (!dimensionMatch) return xml;
  const endRef = dimensionMatch[2].split(":").pop();
  const end = parseCellRef(endRef);
  if (end) {
    usedR = Math.max(usedR, end.r);
    usedC = Math.max(usedC, end.c);
  }
  const ref = `A1:${indexToCol(usedC)}${usedR + 1}`;
  return String(xml).replace(dimensionMatch[0], `<dimension${dimensionMatch[1]}ref="${ref}"${dimensionMatch[3]}/>`);
}

function patchWorksheetXml(xml, sourceSheet, currentSheet) {
  const sourceCells = sourceSheet.cells || {};
  const currentCells = currentSheet.cells || {};
  const changedByRow = new Map();
  const keys = new Set([...Object.keys(sourceCells), ...Object.keys(currentCells)]);
  let patchedCellCount = 0;
  for (const key of keys) {
    if (JSON.stringify(sourceCells[key]?.style || null) !== JSON.stringify(currentCells[key]?.style || null)) {
      const [r, c] = key.split(",").map(Number);
      throw new Error(
        `[SOURCE_STYLE_PATCH_UNSAFE] ${indexToCol(c)}${r + 1} has a new or changed style. The source-preserving patcher will not silently discard it; use an acknowledged Save As rebuild.`
      );
    }
    if (sourceCellsEqual(sourceCells[key], currentCells[key])) continue;
    const [r, c] = key.split(",").map(Number);
    assertZeroBasedCellCoordinates(r, c, `Workbook cell key ${JSON.stringify(key)}`);
    const complexRange = (sourceSheet.complexFormulaRanges || []).find(
      (range) => r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2
    );
    if (complexRange) {
      const ref = `${indexToCol(c)}${r + 1}`;
      throw new Error(
        `[COMPLEX_FORMULA_PATCH_UNSAFE] ${ref} intersects ${complexRange.type} formula range ${complexRange.ref || ref} and cannot be patched independently.`
      );
    }
    if (!changedByRow.has(r)) changedByRow.set(r, new Map());
    changedByRow.get(r).set(c, currentCells[key] || null);
    patchedCellCount += 1;
  }
  if (patchedCellCount === 0) return { xml, patchedCellCount: 0 };

  const sheetDataMatch = String(xml).match(/<sheetData\b([^>]*)>([\s\S]*?)<\/sheetData>|<sheetData\b([^>]*)\/>/i);
  if (!sheetDataMatch) throw new Error("Worksheet is missing sheetData");
  const sheetDataAttrs = sheetDataMatch[1] || sheetDataMatch[3] || "";
  const body = sheetDataMatch[2] || "";
  const rows = new Map();
  const rowRe = /<row\b([^>]*?)(?:>([\s\S]*?)<\/row>|\/\s*>)/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(body))) {
    const attrs = rowMatch[1] || "";
    const rowNumber = Number(attrs.match(/\br="([^"]+)"/i)?.[1]);
    if (!Number.isInteger(rowNumber) || rowNumber < 1) continue;
    rows.set(rowNumber - 1, {
      attrs,
      body: rowMatch[2] || "",
      original: rowMatch[0],
    });
  }

  for (const [r, changes] of changedByRow) {
    const record = rows.get(r) || { attrs: ` r="${r + 1}"`, body: "", original: null };
    for (const token of parseRowCellTokens(record.body)) {
      if (
        token.col != null &&
        changes.has(token.col) &&
        /<f\b[^>]*\bt="(?:shared|array|dataTable)"/i.test(token.xml)
      ) {
        const ref = `${indexToCol(token.col)}${r + 1}`;
        throw new Error(
          `[COMPLEX_FORMULA_PATCH_UNSAFE] ${ref} belongs to a shared, array, or data-table formula and cannot be patched safely.`
        );
      }
    }
    const patchedBody = patchRowBody(record.body, changes, r);
    rows.set(r, {
      ...record,
      original: `<row${rowAttributeText(record.attrs, r + 1)}>${patchedBody}</row>`,
    });
  }

  const rowsXml = [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => row.original)
    .join("");
  const replacement = `<sheetData${sheetDataAttrs}>${rowsXml}</sheetData>`;
  const patched = String(xml).replace(sheetDataMatch[0], replacement);
  return { xml: expandWorksheetDimension(patched, currentSheet), patchedCellCount };
}

function setFullCalculationOnLoad(workbookXml) {
  const calcMatch = String(workbookXml).match(/<calcPr\b([^>]*?)(?:\/\s*>|>[\s\S]*?<\/calcPr>)/i);
  if (calcMatch) {
    let attrs = calcMatch[1] || "";
    for (const name of ["fullCalcOnLoad", "forceFullCalc", "calcMode"]) {
      attrs = withoutXmlAttribute(attrs, name);
    }
    return String(workbookXml).replace(
      calcMatch[0],
      `<calcPr${attrs} fullCalcOnLoad="1" forceFullCalc="1" calcMode="auto"/>`
    );
  }
  return String(workbookXml).replace(
    /<\/workbook>\s*$/i,
    '<calcPr fullCalcOnLoad="1" forceFullCalc="1" calcMode="auto"/></workbook>'
  );
}

function removeCalcChain(files) {
  for (const name of [...files.keys()]) {
    if (name.toLowerCase() === "xl/calcchain.xml") files.delete(name);
  }
  const relsPath = "xl/_rels/workbook.xml.rels";
  if (files.has(relsPath)) {
    const rels = files.get(relsPath).toString("utf8").replace(
      /<Relationship\b(?=[^>]*(?:calcChain|calcchain))[^>]*\/>/gi,
      ""
    );
    files.set(relsPath, Buffer.from(rels, "utf8"));
  }
  const contentTypesPath = "[Content_Types].xml";
  if (files.has(contentTypesPath)) {
    const types = files.get(contentTypesPath).toString("utf8").replace(
      /<Override\b(?=[^>]*(?:calcChain|calcchain))[^>]*\/>/gi,
      ""
    );
    files.set(contentTypesPath, Buffer.from(types, "utf8"));
  }
}

function writeSourcePreservingWorkbook(workbook, filePath, options = {}) {
  assertWorkbookShapeLimits(workbook);
  const sourcePath = workbook.sourcePath;
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error("[SOURCE_PACKAGE_MISSING] The imported Excel source package is unavailable.");
  }
  if (!workbook.sourceFingerprint) {
    throw new Error(
      "[SOURCE_FINGERPRINT_MISSING] This live workbook predates source fingerprinting. Reopen it explicitly before source-preserving export."
    );
  }
  if (!workbook.fidelity?.canRoundTrip || workbook.fidelity?.structureChanged) {
    throw new Error(
      "[SOURCE_PATCH_UNSAFE] Workbook structure changed; a source-preserving cell patch is no longer safe."
    );
  }
  const sourceExt = path.extname(sourcePath).toLowerCase();
  const targetExt = path.extname(filePath).toLowerCase();
  if (sourceExt !== targetExt) {
    throw new Error(
      `[SOURCE_FORMAT_MISMATCH] Source-preserving export requires ${sourceExt}; requested ${targetExt}.`
    );
  }
  assertDistinctSourceTarget(sourcePath, filePath);
  const sourceSnapshot = readStableFile(sourcePath);
  if (!fingerprintsEqual(workbook.sourceFingerprint, sourceSnapshot.fingerprint)) {
    throw new Error(
      `[SOURCE_CHANGED_EXTERNALLY] ${sourcePath} changed after it was opened (size, mtime, or SHA-256 differs). Reopen/reload the workbook at the current revision before exporting; the stale live model will not be applied.`
    );
  }
  const files = unzipBuffer(sourceSnapshot.buffer);
  if ([...files.keys()].some((name) => name.toLowerCase().startsWith("_xmlsignatures/"))) {
    throw new Error(
      "[SIGNED_PACKAGE_PATCH_UNSAFE] The workbook has an OOXML package signature that would be invalidated by editing."
    );
  }
  const descriptors = workbookSheetDescriptors(files);
  if (descriptors.length !== workbook.sheets.length) {
    throw new Error("[SOURCE_PATCH_UNSAFE] Sheet count differs from the imported source.");
  }
  for (let index = 0; index < descriptors.length; index += 1) {
    if (descriptors[index].name !== workbook.sheets[index].name) {
      throw new Error(
        `[SOURCE_PATCH_UNSAFE] Sheet ${index + 1} changed from ${descriptors[index].name} to ${workbook.sheets[index].name}.`
      );
    }
  }
  const sharedStrings = parseSharedStrings(
    (files.get("xl/sharedStrings.xml") || Buffer.alloc(0)).toString("utf8")
  );
  const styles = parseStyles(
    (files.get("xl/styles.xml") || Buffer.alloc(0)).toString("utf8")
  );
  const cellBudget = createCellParseBudget();
  let patchedCellCount = 0;
  for (let index = 0; index < descriptors.length; index += 1) {
    const descriptor = descriptors[index];
    const xml = files.get(descriptor.path).toString("utf8");
    const sourceSheet = parseWorksheet(xml, sharedStrings, cellBudget, styles);
    if (JSON.stringify(sourceSheet.layout || null) !== JSON.stringify(workbook.sheets[index].layout || null)) {
      throw new Error(
        `[SOURCE_LAYOUT_PATCH_UNSAFE] Layout changed on ${descriptors[index].name}. The source-preserving patcher will not silently discard it; use an acknowledged Save As rebuild.`
      );
    }
    const patched = patchWorksheetXml(xml, sourceSheet, workbook.sheets[index]);
    patchedCellCount += patched.patchedCellCount;
    files.set(descriptor.path, Buffer.from(patched.xml, "utf8"));
  }
  const workbookPath = "xl/workbook.xml";
  files.set(
    workbookPath,
    Buffer.from(setFullCalculationOnLoad(files.get(workbookPath).toString("utf8")), "utf8")
  );
  removeCalcChain(files);
  const buffer = zipStore([...files.entries()].map(([name, data]) => ({ name, data })));
  const finalSourceFingerprint = readStableFile(sourcePath).fingerprint;
  if (!fingerprintsEqual(sourceSnapshot.fingerprint, finalSourceFingerprint)) {
    throw new Error(
      `[SOURCE_CHANGED_EXTERNALLY] ${sourcePath} changed during export preparation. Reopen/reload and retry.`
    );
  }
  const resolvedTargetPath = assertDistinctSourceTarget(sourcePath, filePath);
  writeFileAtomic(resolvedTargetPath, buffer, undefined, options.atomicWriteOptions || {});
  const outputFingerprint = readStableFile(resolvedTargetPath).fingerprint;
  return {
    path: filePath,
    format: targetExt.slice(1),
    mode: "source-preserving-cell-patch",
    sourcePath,
    patchedCellCount,
    preservedPackagePartCount: files.size,
    fullCalcOnLoad: true,
    sourceFingerprintVerified: true,
    outputFingerprint,
  };
}

function writeXlsxBuffer(workbook) {
  assertWorkbookShapeLimits(workbook);
  const shared = buildSharedStrings(workbook);
  const styleTable = createStyleTable(workbook);
  const sheets = workbook.sheets || [];
  const sheetEntries = sheets.map((sheet, i) => ({
    name: `xl/worksheets/sheet${i + 1}.xml`,
    data: sheetToXml(sheet, shared, styleTable),
  }));

  const sharedXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.list.length}" uniqueCount="${shared.list.length}">` +
    shared.list.map((s) => `<si><t>${escapeXml(s)}</t></si>`).join("") +
    `</sst>`;

  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>` +
    sheets
      .map(
        (sheet, i) =>
          `<sheet name="${escapeXml(sheet.name || `Sheet${i + 1}`)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
      )
      .join("") +
    `</sheets>` +
    `<calcPr fullCalcOnLoad="1" forceFullCalc="1" calcMode="auto"/>` +
    `</workbook>`;

  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
      )
      .join("") +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
    `<Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheets
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      )
      .join("") +
    `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `</Types>`;

  const entries = [
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rootRels },
    { name: "xl/workbook.xml", data: workbookXml },
    { name: "xl/_rels/workbook.xml.rels", data: workbookRels },
    { name: "xl/sharedStrings.xml", data: sharedXml },
    { name: "xl/styles.xml", data: styleTable.xml },
    ...sheetEntries,
  ];

  return zipStore(entries);
}

function sheetToMatrix(sheet) {
  assertSheetDimensions(Number(sheet?.rows), Number(sheet?.cols), "CSV worksheet");
  const rows = [];
  const maxR = Math.max(0, (sheet.rows || 1) - 1);
  const maxC = Math.max(0, (sheet.cols || 1) - 1);
  // Prefer used region
  let usedR = 0;
  let usedC = 0;
  for (const key of Object.keys(sheet.cells || {})) {
    const [r, c] = key.split(",").map(Number);
    assertZeroBasedCellCoordinates(r, c, `Workbook cell key ${JSON.stringify(key)}`);
    if (r > usedR) usedR = r;
    if (c > usedC) usedC = c;
  }
  const rowCount = Math.min(maxR, usedR) + 1;
  const colCount = Math.min(maxC, usedC) + 1;
  const denseCellCount = rowCount * colCount;
  if (!Number.isSafeInteger(denseCellCount) || denseCellCount > MAX_DENSE_EXPORT_CELLS) {
    throw new Error(
      `[DENSE_EXPORT_CELL_LIMIT] CSV export would materialize ${denseCellCount} cells; maximum is ${MAX_DENSE_EXPORT_CELLS}. Narrow the used range before exporting.`
    );
  }
  for (let r = 0; r < rowCount; r += 1) {
    const row = [];
    for (let c = 0; c < colCount; c += 1) {
      const cell = sheet.cells[cellKey(r, c)];
      if (!cell) {
        row.push("");
      } else if (cell.f) {
        row.push(cell.v != null ? cell.v : `=${cell.f}`);
      } else {
        row.push(cell.v == null ? "" : cell.v);
      }
    }
    rows.push(row);
  }
  return rows;
}

function writeWorkbookFile(workbook, filePath, options = {}) {
  if (!filePath) {
    throw new Error("Output path is required");
  }
  const ext = path.extname(filePath).toLowerCase();
  const dir = path.dirname(filePath);
  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (ext === ".csv") {
    const sheet = workbook.sheets.find((s) => s.id === workbook.activeSheetId) || workbook.sheets[0];
    const csv = serializeCsv(sheetToMatrix(sheet));
    writeFileAtomic(filePath, csv, "utf8", options.atomicWriteOptions || {});
    return { path: filePath, format: "csv" };
  }
  if (ext === ".json") {
    writeFileAtomic(
      filePath,
      `${JSON.stringify(workbook, null, 2)}\n`,
      "utf8",
      options.atomicWriteOptions || {}
    );
    return { path: filePath, format: "json" };
  }
  if (ext === ".xlsx" || ext === ".xlsm") {
    const sourceExt = path.extname(workbook.sourcePath || "").toLowerCase();
    const hasExcelSource = sourceExt === ".xlsx" || sourceExt === ".xlsm";
    if (hasExcelSource) {
      try {
        return writeSourcePreservingWorkbook(workbook, filePath, options);
      } catch (error) {
        if (
          /^\[(?:SOURCE_CHANGED_EXTERNALLY|SOURCE_CHANGED_DURING_READ|SOURCE_FINGERPRINT_MISSING|SOURCE_PACKAGE_MISSING|SOURCE_TARGET_ALIAS_BLOCKED|SOURCE_TARGET_IDENTITY_CHECK_FAILED|EXPORT_TARGET_CHANGED|EXPORT_TARGET_APPEARED)\]/.test(
            String(error.message || "")
          )
        ) {
          throw error;
        }
        if (!options.allowLossyRebuild) throw error;
        if (ext === ".xlsm") {
          throw new Error(
            `[LOSSY_XLSM_BLOCKED] Cannot rebuild ${filePath} without losing or invalidating VBA content. Save As .xlsx instead.`
          );
        }
        const buffer = writeXlsxBuffer(workbook);
        writeFileAtomic(filePath, buffer, undefined, options.atomicWriteOptions || {});
        return {
          path: filePath,
          format: "xlsx",
          mode: "lossy-rebuild",
          warning: error.message,
          fullCalcOnLoad: true,
        };
      }
    }
    if (ext === ".xlsm") {
      throw new Error("Creating a new macro-enabled .xlsm package is not supported.");
    }
    const buffer = writeXlsxBuffer(workbook);
    writeFileAtomic(filePath, buffer, undefined, options.atomicWriteOptions || {});
    return { path: filePath, format: "xlsx", mode: "new-minimal-package" };
  }
  throw new Error(`Unsupported export type: ${ext || "(none)"}`);
}

function writeFileAtomic(filePath, data, encoding, options = {}) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempPath = path.join(
    dir,
    `.${base}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`
  );
  let handle = null;
  try {
    handle = fs.openSync(tempPath, "wx", 0o600);
    if (encoding) {
      fs.writeFileSync(handle, data, encoding);
    } else {
      fs.writeFileSync(handle, data);
    }
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = null;
    if (options.expectedTargetFingerprint) {
      if (!fs.existsSync(filePath)) {
        throw new Error(`[EXPORT_TARGET_CHANGED] ${filePath} disappeared before replacement.`);
      }
      const currentFingerprint = readStableFile(filePath).fingerprint;
      if (!fingerprintsEqual(options.expectedTargetFingerprint, currentFingerprint)) {
        throw new Error(`[EXPORT_TARGET_CHANGED] ${filePath} changed before replacement.`);
      }
    } else if (options.expectTargetMissing === true && fs.existsSync(filePath)) {
      throw new Error(`[EXPORT_TARGET_APPEARED] ${filePath} was created before export completed.`);
    }
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    if (handle != null) {
      try {
        fs.closeSync(handle);
      } catch (_closeError) {
        // Preserve the original write error.
      }
    }
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch (_cleanupError) {
      // Best-effort cleanup; never mask the original write error.
    }
    throw new Error(`Failed to atomically write ${filePath}: ${error.message}`);
  }
}

module.exports = {
  limits: Object.freeze({
    maxZipFileBytes: MAX_ZIP_FILE_BYTES,
    maxCsvFileBytes: MAX_CSV_FILE_BYTES,
    maxJsonFileBytes: MAX_JSON_FILE_BYTES,
    maxParsedCells: MAX_XLSX_PARSED_CELLS,
    maxCsvParsedCells: MAX_CSV_PARSED_CELLS,
    maxDenseExportCells: MAX_DENSE_EXPORT_CELLS,
    maxComplexFormulaCoverageCells: MAX_COMPLEX_FORMULA_COVERAGE_CELLS,
    excelMaxRows: EXCEL_MAX_ROWS,
    excelMaxColumns: EXCEL_MAX_COLUMNS,
  }),
  unzipBuffer,
  zipStore,
  readStableFile,
  fingerprintsEqual,
  readWorkbookFile,
  writeWorkbookFile,
  writeFileAtomic,
  writeXlsxBuffer,
  writeSourcePreservingWorkbook,
  sheetToMatrix,
  crc32,
};
