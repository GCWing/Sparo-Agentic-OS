import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { MarkdownRendererProps } from '@/shared/markdown';
import { incrementFlowChatCounter } from '../performance/flowChatPerf';
import { invalidateFlowLayout } from '../scroll/FlowLayoutMutationEvents';
import { MarkdownBlockRenderer } from './MarkdownBlockRenderer';
import { parseStreamingMarkdownDocument } from './streamingMarkdownParser';
import './StreamingMarkdownRenderer.scss';

type MarkdownCallbacks = Pick<
  MarkdownRendererProps,
  'onFileViewRequest' | 'onTabOpen' | 'onOpenVisualization' | 'onReproductionProceed'
>;

export interface StreamingMarkdownRendererProps extends MarkdownCallbacks {
  textItemId: string;
  content: string;
  streaming: boolean;
  className?: string;
}

function useFrameCoalescedStreamingContent(content: string, streaming: boolean): string {
  const [frameContent, setFrameContent] = useState(content);
  const latestContentRef = useRef(content);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    latestContentRef.current = content;

    if (!streaming) {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      setFrameContent(content);
      return undefined;
    }

    if (frameRef.current === null) {
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        setFrameContent(latestContentRef.current);
      });
    }

    return undefined;
  }, [content, streaming]);

  useEffect(() => () => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
    }
  }, []);

  return streaming ? frameContent : content;
}

export const StreamingMarkdownRenderer = React.memo<StreamingMarkdownRendererProps>(({
  textItemId,
  content,
  streaming,
  className = '',
  onFileViewRequest,
  onTabOpen,
  onOpenVisualization,
  onReproductionProceed,
}) => {
  incrementFlowChatCounter('markdown.streaming.render');
  const previousStreamingRef = useRef(streaming);
  const frameContent = useFrameCoalescedStreamingContent(content, streaming);
  const document = useMemo(
    () => parseStreamingMarkdownDocument(textItemId, frameContent, streaming),
    [textItemId, frameContent, streaming]
  );

  useEffect(() => {
    const wasStreaming = previousStreamingRef.current;
    previousStreamingRef.current = streaming;

    if (wasStreaming && !streaming) {
      invalidateFlowLayout({
        reason: 'markdown-terminal-upgrade',
        priority: 'high',
        source: 'streaming-markdown-renderer',
        textItemId,
      });
    }
  }, [streaming, textItemId]);

  const wrapperClassName = [
    'markdown-renderer',
    'streaming-markdown',
    streaming ? 'markdown-renderer--streaming streaming-markdown--streaming' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={wrapperClassName} data-block-count={document.blocks.length}>
      {document.blocks.map(block => (
        <MarkdownBlockRenderer
          key={block.id}
          block={block}
          streaming={streaming}
          onFileViewRequest={onFileViewRequest}
          onTabOpen={onTabOpen}
          onOpenVisualization={onOpenVisualization}
          onReproductionProceed={onReproductionProceed}
        />
      ))}
    </div>
  );
});

StreamingMarkdownRenderer.displayName = 'StreamingMarkdownRenderer';
