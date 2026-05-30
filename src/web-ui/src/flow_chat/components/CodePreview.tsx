/**
 * CodePreview component
 * Lightweight, read-only code preview with syntax highlighting and streaming support
 *
 * Design notes:
 * 1. Use react-syntax-highlighter (Prism) instead of Monaco Editor
 *    - Monaco is heavy (2-3MB per instance) and hurts virtual list performance
 *    - Prism is lightweight and works well with streaming re-renders
 * 2. Auto-detect language from file extension
 * 3. Use memoization to avoid unnecessary re-renders
 * 4. Large content can be truncated when exceeding limits
 */

import React, { useMemo, memo, useState, useCallback, useDeferredValue } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { getPrismLanguage } from '@/infrastructure/language-detection';
import { useTheme } from '@/infrastructure/theme';
import { useNestedFlowScrollController } from '../scroll/adapters/useNestedFlowScrollController';
import { buildCodePreviewPrismStyle, CODE_PREVIEW_FONT_FAMILY } from './codePreviewPrismTheme';
import './CodePreview.scss';

export interface CodePreviewProps {
  /** Code content */
  content: string;
  /** File path (used for language detection and navigation) */
  filePath?: string;
  /** Explicit language (overrides auto-detection) */
  language?: string;
  /** Whether streaming is in progress */
  isStreaming?: boolean;
  /** Whether to show line numbers */
  showLineNumbers?: boolean;
  /** Custom class name */
  className?: string;
  /** Auto-scroll to bottom while streaming */
  autoScrollToBottom?: boolean;
  /** Max height (px) */
  maxHeight?: number;
  /** Line click callback (line numbers start at 1) */
  onLineClick?: (lineNumber: number, filePath?: string) => void;
}

/**
 * Detect language from file path using the global language detection service.
 */
function detectLanguageFromPath(filePath: string): string {
  if (!filePath) return 'text';
  return getPrismLanguage(filePath);
}

/**
 * CodePreview component with streaming-friendly syntax highlighting.
 */
export const CodePreview: React.FC<CodePreviewProps> = memo(({
  content,
  filePath,
  language,
  isStreaming = false,
  showLineNumbers = true,
  className = '',
  autoScrollToBottom = true,
  maxHeight = 400,
  onLineClick,
}) => {
  const { isLight } = useTheme();
  const prismStyle = useMemo(() => buildCodePreviewPrismStyle(isLight), [isLight]);

  const { scrollContainerRef: containerRef } = useNestedFlowScrollController({
    isStreaming: isStreaming && autoScrollToBottom,
    dependencies: [content],
    resetKey: filePath,
  });

  // During streaming, content updates at high frequency. Defer the highlighted
  // content passed to SyntaxHighlighter so that auto-scroll and cursor updates
  // (which use the real content) remain responsive on the main thread while
  // tokenization runs during browser idle time.
  const deferredContent = useDeferredValue(content);

  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);
  
  const detectedLanguage = useMemo(() => {
    if (language) return language;
    if (filePath) return detectLanguageFromPath(filePath);
    return 'text';
  }, [language, filePath]);
  
  const handleLineClick = useCallback((lineNumber: number) => {
    setHighlightedLine(prev => prev === lineNumber ? null : lineNumber);
    // Trigger callback for editor navigation.
    onLineClick?.(lineNumber, filePath);
  }, [onLineClick, filePath]);
  
  const lineProps = useCallback((lineNumber: number): React.HTMLProps<HTMLElement> => {
    const isHighlighted = highlightedLine === lineNumber;
    return {
      style: {
        display: 'block',
        backgroundColor: isHighlighted ? 'color-mix(in srgb, var(--ds-tool-family-agent-app-fg) 15%, transparent)' : 'transparent',
        borderLeft: isHighlighted ? '3px solid var(--ds-color-accent-500, var(--ds-tool-family-agent-app-fg))' : '3px solid transparent',
        marginLeft: '-3px',
        paddingLeft: '3px',
        transition: 'background-color 0.15s ease, border-color 0.15s ease',
      },
      onClick: () => handleLineClick(lineNumber),
      className: isHighlighted ? 'code-line--highlighted' : '',
    };
  }, [highlightedLine, handleLineClick]);
  
  if (!content) {
    return (
      <div className={`code-preview code-preview--empty ${className}`}>
        <span className="code-preview__placeholder">No content</span>
      </div>
    );
  }
  
  const containerStyle: React.CSSProperties = {
    maxHeight: `${maxHeight}px`,
  };
  
  return (
    <div className={`code-preview ${isStreaming ? 'code-preview--streaming' : ''} ${className}`}>
      <div 
        ref={containerRef}
        className="code-preview__content"
        style={containerStyle}
      >
        <SyntaxHighlighter
          language={detectedLanguage}
          style={prismStyle}
          showLineNumbers={showLineNumbers}
          wrapLines={true}
          wrapLongLines={true}
          lineProps={lineProps}
          customStyle={{
            margin: 0,
            padding: 0,
            background: 'transparent',
            overflow: 'visible',
          }}
          codeTagProps={{
            style: {
              fontFamily: CODE_PREVIEW_FONT_FAMILY,
              fontSize: '12px',
              lineHeight: '1.6',
              fontWeight: 400,
            }
          }}
          lineNumberStyle={{
            minWidth: '2.5em',
            paddingRight: '1em',
            textAlign: 'right',
            userSelect: 'none',
            color: 'var(--ds-color-text-muted)',
            opacity: isLight ? 0.88 : 0.6,
          }}
        >
          {deferredContent}
        </SyntaxHighlighter>
        
        {/* Streaming cursor indicator */}
        {isStreaming && (
          <span className="code-preview__cursor" />
        )}
      </div>
    </div>
  );
});

CodePreview.displayName = 'CodePreview';

export default CodePreview;

