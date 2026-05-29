/**
 * Streaming text block component.
 * Applies a typewriter effect during streaming to smooth out
 * the batched content updates from EventBatcher (~100ms).
 * Supports a streaming cursor indicator.
 */

import React, { useState, useEffect, useRef } from 'react';
import { MarkdownRenderer } from '@/shared/markdown';
import type { FlowTextItem } from '../types/flow-chat';
import { useFlowChatStaticContext } from './modern/FlowChatContext';
import { useTypewriter } from '../hooks/useTypewriter';
import { deriveTextBlockState } from '../runtime/statusModel';
import './FlowTextBlock.scss';

// Idle timeout (ms) after content stops growing.
const CONTENT_IDLE_TIMEOUT = 500;
const LONG_MARKDOWN_THRESHOLD = 6000;
const COMPLEX_MARKDOWN_RE = /(^|\n)(```|~~~|\|.+\||\s*[-*:]+\s*\|\s*[-*:]+|<table\b|!\[|<img\b|```mermaid)/i;

interface FlowTextBlockProps {
  textItem: FlowTextItem;
  className?: string;
}

/**
 * Use React.memo to avoid unnecessary re-renders.
 * Re-render only when key textItem fields change.
 */
export const FlowTextBlock = React.memo<FlowTextBlockProps>(({
  textItem,
  className = ''
}) => {
  const { onFileViewRequest, onTabOpen, onOpenVisualization } = useFlowChatStaticContext();

  // Normalize content to a string.
  const content = typeof textItem.content === 'string'
    ? textItem.content
    : String(textItem.content || '');

  const textState = deriveTextBlockState(textItem);
  const isStreaming = textState === 'streaming';
  const isComplexMarkdown = textItem.isMarkdown && (
    content.length > LONG_MARKDOWN_THRESHOLD ||
    COMPLEX_MARKDOWN_RE.test(content)
  );
  const displayContent = useTypewriter(content, isStreaming, isComplexMarkdown
    ? { frameInterval: 120, revealDuration: 240, minCharsPerTick: 96 }
    : undefined);
  
  // Heuristic: if content does not change for a while, streaming is done.
  const [isContentGrowing, setIsContentGrowing] = useState(true);
  const lastContentRef = useRef(content);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  useEffect(() => {
    if (content !== lastContentRef.current) {
      lastContentRef.current = content;
      setIsContentGrowing(true);
      
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      
      timeoutRef.current = setTimeout(() => {
        setIsContentGrowing(false);
      }, CONTENT_IDLE_TIMEOUT);
    }
    
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [content]);
  
  useEffect(() => {
    if (textState !== 'streaming') {
      setIsContentGrowing(false);
    }
  }, [textState]);
  
  const isActivelyStreaming = textState === 'streaming' && isContentGrowing;
  const hasContent = content.length > 0;

  return (
    <div className={`flow-text-block ${className} ${isActivelyStreaming ? 'streaming' : ''}`}>
      {textItem.isMarkdown ? (
        <MarkdownRenderer
          content={displayContent}
          isStreaming={isActivelyStreaming}
          onFileViewRequest={onFileViewRequest}
          onTabOpen={onTabOpen}
          onOpenVisualization={(visualization) => {
            onOpenVisualization?.(visualization?.type, visualization?.data);
          }}
        />
      ) : (
        <div className={`text-content ${isActivelyStreaming && hasContent ? 'text-content--streaming' : ''}`}>
          {displayContent}
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  const prev = prevProps.textItem;
  const next = nextProps.textItem;
  return (
    prev.id === next.id &&
    prev.content === next.content &&
    prev.isStreaming === next.isStreaming &&
    prev.status === next.status &&
    prevProps.className === nextProps.className
  );
});
