/**
 * Scroll-to-bottom button.
 * Shows when the user scrolls up; click to return to latest messages.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { IconButton, Tooltip } from '@/design-system';
import './ScrollToBottomButton.scss';

interface ScrollToBottomButtonProps {
  visible: boolean;
  onClick: () => void;
  unreadCount?: number; // Optional: show unread message count.
  className?: string;
}

export const ScrollToBottomButton: React.FC<ScrollToBottomButtonProps> = ({
  visible,
  onClick,
  unreadCount,
  className = ''
}) => {
  const { t } = useTranslation('flow-chat');
  
  if (!visible) return null;

  return (
    <Tooltip content={t('scroll.toBottom')}>
      <IconButton
        className={`scroll-to-bottom-button ${className}`}
        onClick={onClick}
        aria-label={unreadCount ? t('scroll.toBottomWithCount', { count: unreadCount }) : t('scroll.toBottom')}
        size="medium"
        variant="default"
      >
        <ChevronDown className="scroll-icon" size={20} strokeWidth={3} />
        {unreadCount !== undefined && unreadCount > 0 && (
          <span className="unread-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </IconButton>
    </Tooltip>
  );
};

