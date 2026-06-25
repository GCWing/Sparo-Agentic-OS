const SECRET_KEY_RE = /(password|passwd|token|secret|apikey|api_key|private|storePassword|keyPassword)/i;
const SECRET_VALUE_RE = /(keyPassword|storePassword|password|token|secret)\s*[:=]\s*["']?[^"',\s}]+/gi;

function redactText(value) {
  return String(value || "")
    .replace(SECRET_VALUE_RE, (match) => {
      const key = match.split(/[:=]/)[0] || "secret";
      return `${key}: [redacted]`;
    });
}

function redactValue(value) {
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? redactText(value) : value;
  }
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY_RE.test(key)) {
      out[key] = "[redacted]";
    } else if (/^(certpath|profile|storeFile)$/i.test(key)) {
      out[key] = item ? "[path redacted]" : item;
    } else if (typeof item === "string") {
      out[key] = redactText(item);
    } else {
      out[key] = redactValue(item);
    }
  }
  return out;
}

function diagnostic(severity, message, extra = {}) {
  return redactValue({
    severity,
    message,
    ...extra,
  });
}

module.exports = {
  diagnostic,
  redactText,
  redactValue,
};
