/**
 * NotificationButton global notification indicator for TitleBar.
 *
 * Extracted from StatusBar. Shows bell icon (with dot on unread),
 * or active task progress indicator. Clicking opens NotificationCenter.
 */

import React from 'react';
import { Bell, BellRing } from 'lucide-react';
import { Badge, Button, IconButton, StatusDot, Tooltip } from '@/design-system';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import {
  useUnreadCount,
  useLatestTaskNotification,
} from '../../../shared/notification-system/hooks/useNotificationState';
import { notificationService } from '../../../shared/notification-system/services/NotificationService';
import './NotificationButton.scss';

interface NotificationButtonProps {
  className?: string;
  navFooterHoverIconSwap?: boolean;
  tooltipPlacement?: 'right' | 'left' | 'top' | 'bottom';
}

const NotificationButton: React.FC<NotificationButtonProps> = ({
  className = '',
  navFooterHoverIconSwap = false,
  tooltipPlacement = 'right',
}) => {
  const { t } = useI18n('common');
  const unreadCount = useUnreadCount();
  const activeNotification = useLatestTaskNotification();
  const hasUnread = unreadCount > 0;
  const notificationLabel = t('nav.notifications');

  const classNames = [
    'sparo-notification-button',
    activeNotification ? 'sparo-notification-button--has-progress' : '',
    activeNotification?.variant === 'loading' ? 'sparo-notification-button--loading' : '',
    navFooterHoverIconSwap && !activeNotification ? 'sparo-notification-button--footer-hover-icon' : '',
    className,
  ].filter(Boolean).join(' ');

  if (activeNotification) {
    const mode = activeNotification.progressMode ||
      (activeNotification.textOnly ? 'text-only' : 'percentage');
    const progressText = activeNotification.variant === 'loading'
      ? activeNotification.message
      : (
          mode === 'fraction' &&
          activeNotification.current !== undefined &&
          activeNotification.total !== undefined
        )
        ? `${activeNotification.current}/${activeNotification.total}`
        : `${Math.round(activeNotification.progress || 0)}%`;

    return (
      <Tooltip content={activeNotification.title} placement={tooltipPlacement}>
        <Button
          variant="ghost"
          size="small"
          className={classNames}
          onClick={() => notificationService.toggleCenter()}
          type="button"
          data-testid="notification-button"
          aria-label={notificationLabel}
        >
          <span className="sparo-notification-button__progress">
            {activeNotification.variant === 'loading' ? (
              <span className="sparo-notification-button__loading-icon" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5"
                  className="sparo-notification-button__spinner">
                  <path d="M12 2 A 10 10 0 0 1 22 12" strokeLinecap="round" />
                </svg>
              </span>
            ) : (
              <span className="sparo-notification-button__progress-icon" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" opacity="0.2" />
                  <path d="M12 2 A 10 10 0 0 1 22 12" strokeLinecap="round"
                    style={{
                      strokeDasharray: `${(activeNotification.progress || 0) * 0.628} 62.8`,
                      transform: 'rotate(-90deg)',
                      transformOrigin: 'center',
                    }}
                  />
                </svg>
              </span>
            )}
            <Badge
              variant={activeNotification.variant === 'loading' ? 'info' : 'accent'}
              className="sparo-notification-button__progress-text"
            >
              {progressText}
            </Badge>
          </span>
        </Button>
      </Tooltip>
    );
  }

  return (
    <IconButton
      variant="ghost"
      size="small"
      className={classNames}
      onClick={() => notificationService.toggleCenter()}
      type="button"
      data-testid="notification-button"
      aria-label={notificationLabel}
      tooltip={notificationLabel}
      tooltipPlacement={tooltipPlacement}
      tooltipFollowCursor={false}
    >
      {navFooterHoverIconSwap ? (
        <span className="sparo-notification-button__footer-icon-swap" aria-hidden="true">
          <span className="sparo-notification-button__icon-wrap sparo-notification-button__footer-icon-default">
            <Bell size={15} />
            {hasUnread && (
              <StatusDot
                tone="accent"
                size="small"
                className="sparo-notification-button__unread-dot"
              />
            )}
          </span>
          <BellRing size={15} className="sparo-notification-button__footer-icon-hover" />
        </span>
      ) : (
        <span className="sparo-notification-button__icon-wrap" aria-hidden="true">
          <Bell size={14} />
          {hasUnread && (
            <StatusDot
              tone="accent"
              size="small"
              className="sparo-notification-button__unread-dot"
            />
          )}
        </span>
      )}
    </IconButton>
  );
};

export default NotificationButton;
