/**
 * Scroll-to-latest bar.
 * Minimal divider style with a soft fade.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown } from 'lucide-react';
import { IconButton } from '@/design-system';
import {
  CHAT_INPUT_DROP_ZONE_BOTTOM_PX,
  SCROLL_TO_LATEST_INPUT_CLEARANCE_PX,
} from '../utils/flowChatScrollLayout';
import './ScrollToLatestBar.scss';

interface ScrollToLatestBarProps {
  visible: boolean;
  onClick: () => void;
  /** Whether ChatInput is expanded. */
  isInputExpanded?: boolean;
  /** Whether ChatInput is active. */
  isInputActive?: boolean;
  /** Measured height of the ChatInput container in pixels (0 if unknown). */
  inputHeight?: number;
  className?: string;
}

export const ScrollToLatestBar: React.FC<ScrollToLatestBarProps> = ({
  visible,
  onClick,
  isInputExpanded = false,
  isInputActive = true,
  inputHeight = 0,
  className = ''
}) => {
  const { t } = useTranslation('flow-chat');
  
  if (!visible) return null;

  // Derive the modifier class from ChatInput state.
  const inputStateClass = !isInputActive 
    ? 'scroll-to-latest-bar--input-collapsed'
    : isInputExpanded 
      ? 'scroll-to-latest-bar--input-expanded' 
      : '';

  // Dynamically compute bar height and button position based on measured ChatInput height.
  //
  // IMPORTANT: __content is position:absolute within the bar, so its `bottom` is
  // relative to the bar—not to the viewport. If bottom > barHeight the content
  // overflows the bar and is clipped by virtual-message-list's overflow:hidden.
  // Therefore we always set barHeight >= contentBottom + button clearance together.
  //
  // Layout constants: shared with VirtualMessageList footer (flowChatScrollLayout).
  const ABOVE_BTN = 24; // gradient fade above the control
  let dynamicStyle: React.CSSProperties = {};
  let contentStyle: React.CSSProperties | undefined;

  if (inputHeight > 0) {
    const contentBottom =
      inputHeight + CHAT_INPUT_DROP_ZONE_BOTTOM_PX + SCROLL_TO_LATEST_INPUT_CLEARANCE_PX;
    const barHeight = contentBottom + ABOVE_BTN;

    dynamicStyle = { height: `${barHeight}px` };
    contentStyle = { bottom: `${contentBottom}px` };
  }

  return (
    <div 
      className={`scroll-to-latest-bar ${inputStateClass} ${className}`}
      style={dynamicStyle}
      aria-hidden={!visible}
    >
      <div className="scroll-to-latest-bar__gradient" />
      
      <div className="scroll-to-latest-bar__content" style={contentStyle}>
        <IconButton
          className="scroll-to-latest-bar__control"
          shape="circle"
          size="small"
          variant="ghost"
          onClick={onClick}
          aria-label={t('scroll.toLatest')}
          tooltip={t('scroll.toLatest')}
        >
          <ArrowDown size={16} />
        </IconButton>
      </div>
    </div>
  );
};

ScrollToLatestBar.displayName = 'ScrollToLatestBar';
