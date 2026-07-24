const fs = require("node:fs");

function stripJson5(text) {
  let out = "";
  let inString = false;
  let quote = "";
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        inString = false;
        quote = "";
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out.replace(/,\s*([}\]])/g, "$1");
}

function readJson5(filePath, fallback = null) {
  try {
    const content = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(stripJson5(content));
  } catch {
    return fallback;
  }
}

module.exports = {
  readJson5,
  stripJson5,
};
