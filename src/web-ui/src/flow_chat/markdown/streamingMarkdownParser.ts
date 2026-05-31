import { measureFlowChat } from '../performance/flowChatPerf';

export type StreamingMarkdownBlockKind =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'blockquote'
  | 'code'
  | 'table'
  | 'math'
  | 'html'
  | 'thematic-break';

export interface StreamingMarkdownBlock {
  id: string;
  kind: StreamingMarkdownBlockKind;
  raw: string;
  startOffset: number;
  endOffset: number;
  stable: boolean;
  meta?: {
    headingLevel?: number;
    ordered?: boolean;
    language?: string;
    closed?: boolean;
    lineCount?: number;
  };
}

export interface StreamingMarkdownDocument {
  source: string;
  blocks: StreamingMarkdownBlock[];
  signature: string;
}

interface ParserCacheEntry {
  blocksById: Map<string, StreamingMarkdownBlock>;
}

const CODE_FENCE_RE = /^(\s*)(```|~~~)([^\n`]*)$/;
const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const BLOCKQUOTE_RE = /^\s*>\s?/;
const UNORDERED_LIST_RE = /^\s*[-+*]\s+/;
const ORDERED_LIST_RE = /^\s*\d+[.)]\s+/;
const THEMATIC_BREAK_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const HTML_BLOCK_RE = /^\s*<\/?[A-Za-z][\w:-]*(?:\s|>|\/>)/;
const MATH_BLOCK_RE = /^\s*\$\$\s*$/;
const PARSER_CACHE_LIMIT = 200;
const parserCache = new Map<string, ParserCacheEntry>();

function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function createBlock(
  textItemId: string,
  kind: StreamingMarkdownBlockKind,
  raw: string,
  startOffset: number,
  endOffset: number,
  stable: boolean,
  meta?: StreamingMarkdownBlock['meta']
): StreamingMarkdownBlock {
  return {
    id: `${textItemId}:${startOffset}:${kind}:${stable ? hashString(raw) : 'open'}`,
    kind,
    raw,
    startOffset,
    endOffset,
    stable,
    meta,
  };
}

function reuseStableBlockReferences(
  textItemId: string,
  blocks: StreamingMarkdownBlock[]
): StreamingMarkdownBlock[] {
  const previous = parserCache.get(textItemId);
  if (!previous) {
    parserCache.set(textItemId, {
      blocksById: new Map(blocks.map(block => [block.id, block])),
    });
    evictParserCache();
    return blocks;
  }

  const nextBlocks = blocks.map(block => {
    const cached = previous.blocksById.get(block.id);
    if (
      cached &&
      cached.raw === block.raw &&
      cached.stable === block.stable &&
      cached.startOffset === block.startOffset &&
      cached.endOffset === block.endOffset
    ) {
      return cached;
    }
    return block;
  });

  parserCache.delete(textItemId);
  parserCache.set(textItemId, {
    blocksById: new Map(nextBlocks.map(block => [block.id, block])),
  });
  evictParserCache();
  return nextBlocks;
}

function evictParserCache(): void {
  while (parserCache.size > PARSER_CACHE_LIMIT) {
    const oldestKey = parserCache.keys().next().value;
    if (!oldestKey) return;
    parserCache.delete(oldestKey);
  }
}

function splitLinesWithOffsets(source: string): Array<{ text: string; start: number; end: number }> {
  const lines: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') {
      lines.push({ text: source.slice(start, index), start, end: index + 1 });
      start = index + 1;
    }
  }
  if (start < source.length) {
    lines.push({ text: source.slice(start), start, end: source.length });
  }
  if (source.length === 0) {
    return [];
  }
  return lines;
}

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

function isListLine(line: string): boolean {
  return UNORDERED_LIST_RE.test(line) || ORDERED_LIST_RE.test(line);
}

function isTableDivider(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function looksLikeTable(lines: Array<{ text: string }>, index: number): boolean {
  const current = lines[index]?.text;
  const next = lines[index + 1]?.text;
  return !!current && current.includes('|') && !!next && isTableDivider(next);
}

function trimTrailingBlankLines(raw: string): string {
  return raw.replace(/(?:\r?\n\s*)+$/g, '\n').replace(/\n$/, '');
}

export function parseStreamingMarkdownDocument(
  textItemId: string,
  source: string,
  streaming: boolean
): StreamingMarkdownDocument {
  return measureFlowChat('markdown.streaming.parse', () => {
    const lines = splitLinesWithOffsets(source);
    const blocks: StreamingMarkdownBlock[] = [];
    let index = 0;

    const pushBlock = (
      kind: StreamingMarkdownBlockKind,
      startLineIndex: number,
      endLineIndexExclusive: number,
      stable: boolean,
      meta?: StreamingMarkdownBlock['meta']
    ) => {
      const startOffset = lines[startLineIndex]?.start ?? 0;
      const endOffset = lines[endLineIndexExclusive - 1]?.end ?? source.length;
      const raw = trimTrailingBlankLines(source.slice(startOffset, endOffset));
      if (raw.trim().length === 0) {
        return;
      }
      blocks.push(createBlock(textItemId, kind, raw, startOffset, endOffset, stable, meta));
    };

    while (index < lines.length) {
      const line = lines[index].text;
      if (isBlank(line)) {
        index += 1;
        continue;
      }

      const codeFence = line.match(CODE_FENCE_RE);
      if (codeFence) {
        const fence = codeFence[2];
        const language = codeFence[3]?.trim();
        const startIndex = index;
        index += 1;
        let closed = false;
        while (index < lines.length) {
          if (lines[index].text.trim().startsWith(fence)) {
            index += 1;
            closed = true;
            break;
          }
          index += 1;
        }
        pushBlock('code', startIndex, index, closed || !streaming, {
          language,
          closed,
          lineCount: Math.max(0, index - startIndex - (closed ? 2 : 1)),
        });
        continue;
      }

      if (MATH_BLOCK_RE.test(line)) {
        const startIndex = index;
        index += 1;
        let closed = false;
        while (index < lines.length) {
          if (MATH_BLOCK_RE.test(lines[index].text)) {
            index += 1;
            closed = true;
            break;
          }
          index += 1;
        }
        pushBlock('math', startIndex, index, closed || !streaming, { closed });
        continue;
      }

      if (looksLikeTable(lines, index)) {
        const startIndex = index;
        index += 2;
        while (index < lines.length && lines[index].text.includes('|') && !isBlank(lines[index].text)) {
          index += 1;
        }
        pushBlock('table', startIndex, index, index < lines.length || !streaming);
        continue;
      }

      const heading = line.match(HEADING_RE);
      if (heading) {
        pushBlock('heading', index, index + 1, true, { headingLevel: heading[1].length });
        index += 1;
        continue;
      }

      if (THEMATIC_BREAK_RE.test(line)) {
        pushBlock('thematic-break', index, index + 1, true);
        index += 1;
        continue;
      }

      if (BLOCKQUOTE_RE.test(line)) {
        const startIndex = index;
        while (index < lines.length && (BLOCKQUOTE_RE.test(lines[index].text) || isBlank(lines[index].text))) {
          index += 1;
        }
        pushBlock('blockquote', startIndex, index, index < lines.length || !streaming);
        continue;
      }

      if (isListLine(line)) {
        const ordered = ORDERED_LIST_RE.test(line);
        const startIndex = index;
        while (index < lines.length && (isListLine(lines[index].text) || /^\s{2,}\S/.test(lines[index].text) || isBlank(lines[index].text))) {
          index += 1;
        }
        pushBlock('list', startIndex, index, index < lines.length || !streaming, { ordered });
        continue;
      }

      if (HTML_BLOCK_RE.test(line)) {
        const startIndex = index;
        index += 1;
        while (index < lines.length && !isBlank(lines[index].text)) {
          index += 1;
        }
        pushBlock('html', startIndex, index, index < lines.length || !streaming);
        continue;
      }

      const startIndex = index;
      index += 1;
      while (index < lines.length) {
        const next = lines[index].text;
        if (
          isBlank(next) ||
          CODE_FENCE_RE.test(next) ||
          HEADING_RE.test(next) ||
          BLOCKQUOTE_RE.test(next) ||
          isListLine(next) ||
          THEMATIC_BREAK_RE.test(next) ||
          looksLikeTable(lines, index) ||
          HTML_BLOCK_RE.test(next) ||
          MATH_BLOCK_RE.test(next)
        ) {
          break;
        }
        index += 1;
      }
      pushBlock('paragraph', startIndex, index, index < lines.length || !streaming);
    }

    const reusedBlocks = reuseStableBlockReferences(textItemId, blocks);

    return {
      source,
      blocks: reusedBlocks,
      signature: `${source.length}:${reusedBlocks.length}:${reusedBlocks.map(block => block.id).join('|')}`,
    };
  });
}
