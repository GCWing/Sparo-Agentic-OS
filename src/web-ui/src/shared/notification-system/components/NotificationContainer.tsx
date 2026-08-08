 

import React from 'react';
import { useI18n } from '@/infrastructure/i18n';
import { useActiveNotifications } from '../hooks/useNotificationState';
import { NotificationItem } from './NotificationItem';
import { ProgressNotification } from './ProgressNotification';
import { LoadingNotification } from './LoadingNotification';
import './NotificationContainer.scss';

const isNotificationPreview = import.meta.env.DEV
  && typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).has('notificationPreview');

export const NotificationContainer: React.FC = () => {
  const activeNotifications = useActiveNotifications();
  const { t } = useI18n('common');
  const visibleNotifications = activeNotifications.filter(
    n => n.variant !== 'silent'
  );
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [needsScroll, setNeedsScroll] = React.useState(false);
  const notificationLayoutKey = visibleNotifications
    .map(notification => notification.id)
    .join('|');

  React.useLayoutEffect(() => {
    const container = containerRef.current;
    if (!(container instanceof HTMLElement)) {
      return;
    }

    const items = Array.from(container.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement
    );
    const frontCard = items[items.length - 1]?.firstElementChild;
    if (!(frontCard instanceof HTMLElement)) {
      return;
    }

    const syncLayout = () => {
      container.style.setProperty(
        '--notification-front-height',
        `${frontCard.offsetHeight}px`
      );

      const styles = getComputedStyle(container);
      const paddingBlock = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
      const expandedGap = parseFloat(
        styles.getPropertyValue('--notification-stack-gap')
      ) || 0;
      const expandedContentHeight = items.reduce((height, item) => {
        const card = item.firstElementChild;
        const itemHeight = (
          card instanceof HTMLElement
            ? Math.max(card.scrollHeight, card.offsetHeight)
            : item.scrollHeight
        );
        item.style.setProperty('--notification-item-height', `${itemHeight}px`);
        return height + itemHeight;
      }, paddingBlock) + expandedGap * Math.max(items.length - 1, 0);

      setNeedsScroll(expandedContentHeight > window.innerHeight - 72);
    };

    syncLayout();

    const resizeObserver = new ResizeObserver(syncLayout);
    items.forEach((item) => {
      resizeObserver.observe(item.firstElementChild ?? item);
    });
    window.addEventListener('resize', syncLayout);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', syncLayout);
      container.style.removeProperty('--notification-front-height');
      items.forEach(item => item.style.removeProperty('--notification-item-height'));
    };
  }, [notificationLayoutKey]);

  if (visibleNotifications.length === 0) {
    return null;
  }

  const handlePointerEnter = () => {
    setIsExpanded(true);
  };

  const handlePointerLeave = () => {
    setIsExpanded(false);
  };

  return (
    <div
      ref={containerRef}
      className={[
        'notification-container',
        isNotificationPreview && 'notification-container--preview-light',
        isExpanded && 'notification-container--expanded',
        needsScroll && 'notification-container--scrollable',
      ].filter(Boolean).join(' ')}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      role="region"
      aria-label={t('nav.notifications')}
      aria-live="polite"
      aria-relevant="additions text"
    >
      {visibleNotifications.map((notification) => {
        let content: React.ReactNode;

        if (notification.variant === 'progress') {
          content = <ProgressNotification notification={notification} />;
        } else if (notification.variant === 'loading') {
          content = <LoadingNotification notification={notification} />;
        } else {
          content = <NotificationItem notification={notification} />;
        }

        return (
          <div
            key={notification.id}
            className="notification-container__item"
          >
            {content}
          </div>
        );
      })}
    </div>
  );
};

