import { describe, expect, it } from 'vitest';
import type { AIModelConfig } from '../types';
import {
  patchAIModelSnapshot,
  sanitizeAIModelSnapshot,
} from './modelConfigs';

function model(id: string, overrides: Partial<AIModelConfig> = {}): AIModelConfig {
  return {
    id,
    name: `Provider ${id}`,
    provider: 'openai',
    model_name: `model-${id}`,
    base_url: 'https://example.com/v1',
    context_window: 128_128,
    enabled: true,
    category: 'general_chat',
    capabilities: ['text_chat'],
    ...overrides,
  };
}

describe('model config snapshot projection', () => {
  it('never exposes a secret value from a malformed plaintext snapshot', () => {
    const projected = sanitizeAIModelSnapshot([
      { ...model('one'), api_key: 'plaintext-secret' },
    ]);

    expect(projected[0]).not.toHaveProperty('api_key');
    expect(projected[0]?.api_key_configured).toBe(true);
    expect(JSON.stringify(projected)).not.toContain('plaintext-secret');
  });

  it('rejects incomplete snapshots instead of fabricating model defaults', () => {
    expect(() => sanitizeAIModelSnapshot({})).toThrow('must be an array');
    expect(() => sanitizeAIModelSnapshot([{ ...model('one'), context_window: 0 }]))
      .toThrow('invalid identity or context window');
  });

  it('patches one model against the latest snapshot without replacing external entries', () => {
    const current = [
      { ...model('one'), api_key: { configured: true } },
      { ...model('external'), api_key: { configured: true } },
    ];

    const next = patchAIModelSnapshot(current, [model('one', { enabled: false })]);

    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({
      id: 'one',
      enabled: false,
      api_key: { configured: true },
    });
    expect(next[1]).toEqual(current[1]);
  });

  it('only replaces a secret when a non-empty local input is explicit', () => {
    const current = [{ ...model('one'), api_key: { configured: true } }];

    const preserved = patchAIModelSnapshot(current, [model('one', { api_key: '   ' })]);
    const replaced = patchAIModelSnapshot(current, [model('one', { api_key: 'new-key' })]);

    expect(preserved[0]?.api_key).toEqual({ configured: true });
    expect(replaced[0]?.api_key).toBe('new-key');
  });

  it('removes only named stable ids', () => {
    const current = [
      { ...model('one'), api_key: { configured: false } },
      { ...model('external'), api_key: { configured: true } },
    ];

    const next = patchAIModelSnapshot(current, [], new Set(['one']));

    expect(next).toEqual([current[1]]);
  });
});
