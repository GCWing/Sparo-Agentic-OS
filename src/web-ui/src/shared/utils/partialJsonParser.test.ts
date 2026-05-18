import { describe, expect, it } from 'vitest';

import { normalizePartialJsonBuffer, parsePartialJson } from './partialJsonParser';

describe('partialJsonParser', () => {
  it('normalizes escaped argument buffers with a leading colon', () => {
    const raw = ': "{\\"command\\":\\"pnpm run type-check:web\\",\\"description\\":\\"Check web types\\"';

    expect(normalizePartialJsonBuffer(raw)).toBe(
      '{"command":"pnpm run type-check:web","description":"Check web types"',
    );
    expect(parsePartialJson(raw)).toMatchObject({
      command: 'pnpm run type-check:web',
      description: 'Check web types',
    });
  });

  it('normalizes quoted argument buffers whose inner quotes are already unescaped', () => {
    const raw = ': "{"command":"pnpm run build:web"';

    expect(normalizePartialJsonBuffer(raw)).toBe('{"command":"pnpm run build:web');
    expect(parsePartialJson(raw)).toMatchObject({
      command: 'pnpm run build:web',
    });
  });

  it('keeps normal partial JSON buffers parseable', () => {
    expect(parsePartialJson('{"command":"pnpm test"')).toMatchObject({
      command: 'pnpm test',
    });
  });
});
