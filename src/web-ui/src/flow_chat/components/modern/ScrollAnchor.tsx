/**
 * Scroll anchor component.
 * Shows user message markers with hover preview and jump navigation.
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useVisibleTurnInfo, type VirtualItem } from '../../store/modernFlowChatStore';
import './ScrollAnchor.scss';

interface ScrollAnchorProps {
  virtualItems: VirtualItem[];
  onAnchorNavigate: (turnId: string) => void;
  scrollerRef?: React.RefObject<HTMLElement | null>;
  dockToTimelineSidebar?: boolean;
}

interface AnchorPoint {
  id: string;
  turnId: string;
  index: number;
  offsetPx: number;
  content: string;
  turnNumber: number;
}

const ANCHOR_POINT_GAP_PX = 16;
const MAX_BUBBLE_LINES = 5;
const MAX_BUBBLE_LINE_CHARS = 32;

const ANCHOR_WAVE_METRICS = [
  { width: 34, delay: '0ms' },
  { width: 26, delay: '18ms' },
  { width: 18, delay: '36ms' },
  { width: 14, delay: '54ms' },
] as const;

interface BubblePreview {
  lines: string[];
  highlightedLineIndex: number;
  isTruncated: boolean;
}

const truncateBubbleLine = (line: string, forceEllipsis = false) => {
  const chars = Array.from(line);

  if (!forceEllipsis && chars.length <= MAX_BUBBLE_LINE_CHARS) {
    return {
      text: line,
      isTruncated: false,
    };
  }

  const visibleChars = chars.slice(0, Math.max(0, MAX_BUBBLE_LINE_CHARS - 3)).join('').trimEnd();

  return {
    text: `${visibleChars}...`,
    isTruncated: true,
  };
};


export const ScrollAnchor: React.FC<ScrollAnchorProps> = ({
  virtualItems,
  onAnchorNavigate,
  scrollerRef,
  dockToTimelineSidebar = false,
}) => {
  const { t } = useTranslation('flow-chat');
  const visibleTurnInfo = useVisibleTurnInfo();
  const [hoveredAnchorId, setHoveredAnchorId] = useState<string | null>(null);
  const [isScrolling, setIsScrolling] = useState(false);
  
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isHovering, setIsHovering] = useState(false);

  useEffect(() => {
    const scroller = scrollerRef?.current;
    if (!scroller) return;

    const handleScroll = () => {
      setIsScrolling(true);

      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      scrollTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false);
      }, 800);
    };

    scroller.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      scroller.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [scrollerRef]);

  useEffect(() => {
    const scroller = scrollerRef?.current;
    if (!scroller) return;

    if (isHovering) {
      scroller.classList.add('anchor-hovering');
    } else {
      scroller.classList.remove('anchor-hovering');
    }

    return () => {
      scroller.classList.remove('anchor-hovering');
    };
  }, [scrollerRef, isHovering]);

  const anchorPoints = useMemo<AnchorPoint[]>(() => {
    if (virtualItems.length === 0) return [];

    const userMessageItems = virtualItems
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.type === 'user-message');

    if (userMessageItems.length === 0) return [];

    return userMessageItems.map(({ item, index }, turnIndex) => {
      const itemData = 'data' in item ? item.data : undefined;
      const userMessage = itemData && typeof itemData === 'object'
        ? (itemData as { id?: unknown; content?: unknown })
        : {};
      const offsetPx = (turnIndex - (userMessageItems.length - 1) / 2) * ANCHOR_POINT_GAP_PX;
      const messageId = typeof userMessage.id === 'string' && userMessage.id
        ? userMessage.id
        : item.turnId;
      const content = typeof userMessage.content === 'string' ? userMessage.content : '';

      return {
        id: messageId,
        turnId: item.turnId,
        index,
        offsetPx,
        content,
        turnNumber: turnIndex + 1,
      };
    });
  }, [virtualItems]);

  const hoveredAnchorIndex = useMemo(
    () => anchorPoints.findIndex(anchor => anchor.id === hoveredAnchorId),
    [anchorPoints, hoveredAnchorId],
  );

  const handleAnchorClick = useCallback((anchor: AnchorPoint) => {
    onAnchorNavigate(anchor.turnId);
    setHoveredAnchorId(null);
  }, [onAnchorNavigate]);

  const handleAnchorEnter = useCallback((anchor: AnchorPoint) => {
    setHoveredAnchorId(anchor.id);
    setIsHovering(true);
  }, []);

  const handleAnchorLeave = useCallback(() => {
    setHoveredAnchorId(null);
    setIsHovering(false);
  }, []);

  const getAnchorTitle = useCallback(
    (anchor: AnchorPoint) =>
      anchor.content.trim() || t('flowChatHeader.untitledTurn', { defaultValue: 'Untitled turn' }),
    [t],
  );

  const buildBubblePreview = useCallback((content: string): BubblePreview => {
    const parsedLines = content
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
    const sourceLines = parsedLines.length > 0
      ? parsedLines.slice(0, MAX_BUBBLE_LINES)
      : [t('flowChatHeader.untitledTurn', { defaultValue: 'Untitled turn' })];
    const hasMoreLines = parsedLines.length > MAX_BUBBLE_LINES;
    let isTruncated = hasMoreLines;
    const lines = sourceLines.map((line, index) => {
      const result = truncateBubbleLine(line, hasMoreLines && index === sourceLines.length - 1);
      isTruncated = isTruncated || result.isTruncated;
      return result.text;
    });

    const highlightedLineIndex = sourceLines.reduce((bestIndex, line, index) => {
      return line.length > sourceLines[bestIndex].length ? index : bestIndex;
    }, 0);

    return {
      lines,
      highlightedLineIndex,
      isTruncated,
    };
  }, [t]);

  const handleContainerMouseEnter = useCallback(() => {
    setIsHovering(true);
  }, []);

  const handleContainerMouseLeave = useCallback(() => {
    setIsHovering(false);
    setHoveredAnchorId(null);
  }, []);

  if (anchorPoints.length === 0) return null;

  return (
    <div
      className={[
        'scroll-anchor',
        dockToTimelineSidebar && 'scroll-anchor--timeline-sidebar-open',
        isScrolling && 'scrolling',
        isHovering && 'hovering',
      ]
        .filter(Boolean)
        .join(' ')}
      onMouseEnter={handleContainerMouseEnter}
      onMouseLeave={handleContainerMouseLeave}
    >
      <nav className="scroll-anchor__track" aria-label={t('flowChatHeader.turnList', { defaultValue: 'Turn list' })}>
        {anchorPoints.map((anchor, idx) => {
          const title = getAnchorTitle(anchor);
          const bubblePreview = buildBubblePreview(title);
          const turnLabel = t('flowChatHeader.turnBadge', {
            current: anchor.turnNumber,
            defaultValue: `Turn ${anchor.turnNumber}`,
          });
          const isActive = hoveredAnchorId === anchor.id;
          const isCurrent = visibleTurnInfo?.turnId === anchor.turnId;
          const waveDistance = hoveredAnchorIndex >= 0
            ? Math.abs(idx - hoveredAnchorIndex)
            : Number.POSITIVE_INFINITY;
          const waveMetrics = ANCHOR_WAVE_METRICS[waveDistance];

          return (
            <button
              key={anchor.id}
              type="button"
              className={[
                'scroll-anchor__point',
                isActive && 'scroll-anchor__point--active',
                isCurrent && 'scroll-anchor__point--current',
                waveMetrics && 'scroll-anchor__point--wave',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                top: `calc(50% + ${anchor.offsetPx}px)`,
                '--delay': `${idx * 0.03}s`,
                ...(waveMetrics
                  ? {
                      '--scroll-anchor-wave-width': `${waveMetrics.width}px`,
                      '--scroll-anchor-wave-delay': waveMetrics.delay,
                    }
                  : {}),
              } as React.CSSProperties}
              onClick={(e) => {
                e.stopPropagation();
                handleAnchorClick(anchor);
              }}
              onMouseEnter={() => handleAnchorEnter(anchor)}
              onMouseLeave={handleAnchorLeave}
              onFocus={() => handleAnchorEnter(anchor)}
              onBlur={handleAnchorLeave}
              aria-current={isCurrent ? 'true' : undefined}
              aria-label={t('scroll.anchorJumpToTurn', {
                turn: turnLabel,
                title,
                defaultValue: `Jump to ${turnLabel}: ${title}`,
              })}
              title={title}
            >
              <span className="scroll-anchor__tick" aria-hidden="true" />
              {isActive && (
                <span
                  className={[
                    'scroll-anchor__bubble',
                    bubblePreview.isTruncated && 'scroll-anchor__bubble--truncated',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-hidden="true"
                >
                  <span className="scroll-anchor__bubble-lines">
                    {bubblePreview.lines.map((line, lineIndex) => (
                      <span
                        key={`${anchor.id}-line-${lineIndex}`}
                        className={[
                          'scroll-anchor__bubble-line',
                          lineIndex === bubblePreview.highlightedLineIndex &&
                            'scroll-anchor__bubble-line--highlight',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {line}
                      </span>
                    ))}
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
};

ScrollAnchor.displayName = 'ScrollAnchor';
