 

import { parse, Allow } from 'partial-json';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('PartialJsonParser');

export function normalizePartialJsonBuffer(jsonStr: string): string {
  let normalized = jsonStr.trimStart();

  if (normalized.startsWith(':')) {
    normalized = normalized.slice(1).trimStart();
  }

  if (!normalized.startsWith('"')) {
    return normalized;
  }

  let value = '';
  let escaping = false;

  for (let index = 1; index < normalized.length; index += 1) {
    const char = normalized[index];

    if (escaping) {
      if (char === 'n') value += '\n';
      else if (char === 'r') value += '\r';
      else if (char === 't') value += '\t';
      else if (char === 'b') value += '\b';
      else if (char === 'f') value += '\f';
      else value += char;
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (char === '"' && normalized.slice(index + 1).trim().length === 0) {
      break;
    }

    value += char;
  }

  return value.trimStart().startsWith('{') ? value : normalized;
}

export function parsePartialJson(jsonStr: string): Record<string, any> {
  if (!jsonStr || jsonStr.trim() === '') {
    return {};
  }

  const normalized = normalizePartialJsonBuffer(jsonStr);
  const candidates = normalized === jsonStr ? [jsonStr] : [jsonStr, normalized];

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      try {
        const result = parse(candidate, Allow.ALL);
        return result || {};
      } catch {
      }
    }
  }

  try {
    const result = parse(normalized, Allow.ALL);
    return result || {};
  } catch (error) {
    try {
      const result = parse(jsonStr, Allow.ALL);
      return result || {};
    } catch {
      log.warn('Failed to parse partial JSON', error);
      return {};
    }
  }
}

 
export function isFieldComplete(jsonStr: string, fieldName: string): boolean {
  const parsed = parsePartialJson(jsonStr);
  return fieldName in parsed && parsed[fieldName] !== null && parsed[fieldName] !== undefined;
}

 
export function getFieldValue<T = any>(
  jsonStr: string, 
  fieldName: string, 
  defaultValue?: T
): T | undefined {
  const parsed = parsePartialJson(jsonStr);
  return parsed[fieldName] !== undefined ? parsed[fieldName] : defaultValue;
}

 
export function getFirstAvailableField<T = any>(
  jsonStr: string,
  fieldNames: string[],
  defaultValue?: T
): T | undefined {
  const parsed = parsePartialJson(jsonStr);
  
  for (const fieldName of fieldNames) {
    if (fieldName in parsed && parsed[fieldName] !== null && parsed[fieldName] !== undefined) {
      return parsed[fieldName];
    }
  }
  
  return defaultValue;
}

