import React, { useMemo } from 'react';
import { MarkdownRenderer, type MarkdownRendererProps } from '@/shared/markdown';
import { incrementFlowChatCounter, measureFlowChat } from '../performance/flowChatPerf';
import { useRenderBudgetReady } from '../render/flowRenderBudgetScheduler';
import type { StreamingMarkdownBlock } from './streamingMarkdownParser';

const MAX_LIVE_CODE_LINES = 200;
const MAX_LIVE_CODE_CHARS = 20_000;

type MarkdownCallbacks = Pick<
  MarkdownRendererProps,
  'onFileViewRequest' | 'onTabOpen' | 'onOpenVisualization' | 'onReproductionProceed'
>;

interface MarkdownBlockRendererProps extends MarkdownCallbacks {
  block: StreamingMarkdownBlock;
  streaming: boolean;
}

function stripFence(raw: string): { language: string; code: string } {
  const lines = raw.split(/\r?\n/);
  const first = lines[0] ?? '';
  const fence = first.trim().startsWith('~~~') ? '~~~' : '```';
  const language = first.trim().slice(fence.length).trim();
  const bodyLines = lines.slice(1);
  if (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim().startsWith(fence)) {
    bodyLines.pop();
  }
  return { language, code: bodyLines.join('\n') };
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('`')) {
      nodes.push(<code className="inline-code" key={`${match.index}:code`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={`${match.index}:strong`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*')) {
      nodes.push(<em key={`${match.index}:em`}>{token.slice(1, -1)}</em>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      nodes.push(
        <a
          key={`${match.index}:link`}
          href={link?.[2]}
          onClick={event => event.preventDefault()}
        >
          {link?.[1] ?? token}
        </a>
      );
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function renderLiveLines(raw: string): React.ReactNode[] {
  return raw.split(/\r?\n/).map((line, index) => (
    <React.Fragment key={index}>
      {index > 0 ? <br /> : null}
      {renderInlineMarkdown(line)}
    </React.Fragment>
  ));
}

const LiveMarkdownBlockRenderer = React.memo<{ block: StreamingMarkdownBlock }>(({ block }) => {
  incrementFlowChatCounter('markdown.block.render.live');

  if (block.kind === 'heading') {
    const level = Math.min(6, Math.max(1, block.meta?.headingLevel ?? 2));
    const Tag = `h${level}` as keyof JSX.IntrinsicElements;
    const text = block.raw.replace(/^#{1,6}\s+/, '');
    return <Tag>{renderInlineMarkdown(text)}</Tag>;
  }

  if (block.kind === 'list') {
    const Tag = block.meta?.ordered ? 'ol' : 'ul';
    const items = block.raw
      .split(/\r?\n/)
      .filter(line => line.trim().length > 0)
      .map(line => line.replace(/^\s*(?:[-+*]|\d+[.)])\s+/, '').trim());
    return (
      <Tag>
        {items.map((item, index) => (
          <li key={index}>{renderInlineMarkdown(item)}</li>
        ))}
      </Tag>
    );
  }

  if (block.kind === 'blockquote') {
    const text = block.raw
      .split(/\r?\n/)
      .map(line => line.replace(/^\s*>\s?/, ''))
      .join('\n');
    return <blockquote className="custom-blockquote">{renderLiveLines(text)}</blockquote>;
  }

  if (block.kind === 'code') {
    const { language, code } = stripFence(block.raw);
    const lines = code.split(/\r?\n/);
    const visibleCode = lines.length > MAX_LIVE_CODE_LINES || code.length > MAX_LIVE_CODE_CHARS
      ? lines.slice(-MAX_LIVE_CODE_LINES).join('\n').slice(-MAX_LIVE_CODE_CHARS)
      : code;

    return (
      <div className="streaming-markdown__code-preview">
        <div className="streaming-markdown__code-toolbar">
          <span>{language || 'code'}</span>
          <span>{lines.length} lines</span>
        </div>
        <pre>
          <code>{visibleCode}</code>
        </pre>
      </div>
    );
  }

  if (block.kind === 'table') {
    const rows = block.raw.split(/\r?\n/).filter(line => line.trim().length > 0);
    return (
      <div className="table-wrapper streaming-markdown__table-preview">
        <table>
          <tbody>
            {rows.slice(0, 50).map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.split('|').filter((cell, index, arr) => !(index === 0 || index === arr.length - 1) || cell.trim()).map((cell, cellIndex) => (
                  <td key={cellIndex}>{renderInlineMarkdown(cell.trim())}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (block.kind === 'thematic-break') {
    return <hr />;
  }

  if (block.kind === 'math' || block.kind === 'html') {
    return <pre className="streaming-markdown__structured-preview">{block.raw}</pre>;
  }

  return <p>{renderLiveLines(block.raw)}</p>;
});

LiveMarkdownBlockRenderer.displayName = 'LiveMarkdownBlockRenderer';

export const MarkdownBlockRenderer = React.memo<MarkdownBlockRendererProps>(({
  block,
  streaming,
  onFileViewRequest,
  onTabOpen,
  onOpenVisualization,
  onReproductionProceed,
}) => {
  const shouldRenderRich = true;
  const richKey = `${block.id}:${block.raw.length}`;
  const richReady = useRenderBudgetReady(
    shouldRenderRich,
    richKey,
    'immediate'
  );

  const richContent = useMemo(() => block.raw, [block.raw]);

  if (!shouldRenderRich || !richReady) {
    return (
      <div className="streaming-markdown__block streaming-markdown__block--live" data-kind={block.kind}>
        <LiveMarkdownBlockRenderer block={block} />
      </div>
    );
  }

  incrementFlowChatCounter('markdown.block.render.rich');
  return (
    <div className="streaming-markdown__block streaming-markdown__block--rich" data-kind={block.kind}>
      {measureFlowChat('markdown.block.richRender', () => (
        <MarkdownRenderer
          content={richContent}
          isStreaming={streaming && !block.stable}
          onFileViewRequest={onFileViewRequest}
          onTabOpen={onTabOpen}
          onOpenVisualization={onOpenVisualization}
          onReproductionProceed={onReproductionProceed}
        />
      ))}
    </div>
  );
}, (prev, next) => (
  prev.block === next.block &&
  prev.streaming === next.streaming &&
  prev.onFileViewRequest === next.onFileViewRequest &&
  prev.onTabOpen === next.onTabOpen &&
  prev.onOpenVisualization === next.onOpenVisualization &&
  prev.onReproductionProceed === next.onReproductionProceed
));

MarkdownBlockRenderer.displayName = 'MarkdownBlockRenderer';
