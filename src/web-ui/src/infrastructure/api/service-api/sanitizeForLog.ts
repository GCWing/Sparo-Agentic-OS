const SENSITIVE_KEY_PATTERNS = [
  'api_key',
  'apikey',
  'token',
  'secret',
  'password',
  'authorization',
  'credential',
  'private_key',
  'privatekey'
];

const LARGE_PAYLOAD_KEY_PATTERNS = [
  'pcm16base64',
  'pcm16_base64'
];

const CREDENTIAL_CONTAINER_KEYS = new Set([
  'env',
  'headers',
  'customheaders',
  'extraheaders'
]);

const PRIVATE_CONTENT_KEYS = new Set([
  'content',
  'error',
  'message',
  'prompt',
  'text',
  'userMessage',
  'userPrompt'
].map(normalizeKey));

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some(pattern => normalized.includes(pattern));
}

function isLargePayloadKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return LARGE_PAYLOAD_KEY_PATTERNS.some(pattern => normalized.includes(pattern));
}

function isCredentialContainerKey(key: string): boolean {
  return CREDENTIAL_CONTAINER_KEYS.has(normalizeKey(key));
}

function isPrivateContentKey(key: string): boolean {
  return PRIVATE_CONTENT_KEYS.has(normalizeKey(key));
}

function maskSensitiveValue(_value: unknown): string {
  return '***';
}

function maskCredentialLeaves(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(maskCredentialLeaves);
  }
  if (typeof value !== 'object') {
    return '***';
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, child]) => [key, maskCredentialLeaves(child)])
  );
}

function summarizeLargePayloadValue(value: unknown): string {
  if (typeof value !== 'string') {
    return '[redacted payload]';
  }
  return `[redacted payload: ${value.length} chars]`;
}

export function sanitizeForLog(value: unknown, parentKey?: string): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(item => sanitizeForLog(item, parentKey));
  }

  if (typeof value !== 'object') {
    if (parentKey && isSensitiveKey(parentKey)) {
      return maskSensitiveValue(value);
    }
    if (parentKey && isLargePayloadKey(parentKey)) {
      return summarizeLargePayloadValue(value);
    }
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key) || isPrivateContentKey(key)) {
      sanitized[key] = maskSensitiveValue(rawValue);
      continue;
    }
    if (isLargePayloadKey(key)) {
      sanitized[key] = summarizeLargePayloadValue(rawValue);
      continue;
    }
    if (isCredentialContainerKey(key)) {
      sanitized[key] = maskCredentialLeaves(rawValue);
      continue;
    }
    sanitized[key] = sanitizeForLog(rawValue, key);
  }

  return sanitized;
}
