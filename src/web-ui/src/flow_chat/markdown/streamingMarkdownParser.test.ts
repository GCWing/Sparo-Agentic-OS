import { describe, expect, it } from 'vitest';
import { parseStreamingMarkdownDocument } from './streamingMarkdownParser';

describe('parseStreamingMarkdownDocument', () => {
  it('keeps sealed blocks stable while the tail keeps streaming', () => {
    const doc = parseStreamingMarkdownDocument(
      'text-1',
      '# Title\n\n- first\n- second\n\nA growing paragraph',
      true
    );

    expect(doc.blocks.map(block => block.kind)).toEqual(['heading', 'list', 'paragraph']);
    expect(doc.blocks[0].stable).toBe(true);
    expect(doc.blocks[1].stable).toBe(true);
    expect(doc.blocks[2].stable).toBe(false);
  });

  it('treats an unclosed code fence as a live code block', () => {
    const doc = parseStreamingMarkdownDocument(
      'text-1',
      '```ts\nconst value = 1;\nconsole.log(value);',
      true
    );

    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]).toEqual(expect.objectContaining({
      kind: 'code',
      stable: false,
    }));
    expect(doc.blocks[0].meta).toEqual(expect.objectContaining({
      language: 'ts',
      closed: false,
      lineCount: 2,
    }));
  });

  it('marks closed code fences and tables as stable blocks', () => {
    const doc = parseStreamingMarkdownDocument(
      'text-1',
      '```js\nconsole.log(1)\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n',
      true
    );

    expect(doc.blocks.map(block => `${block.kind}:${block.stable}`)).toEqual([
      'code:true',
      'table:true',
    ]);
  });
});
