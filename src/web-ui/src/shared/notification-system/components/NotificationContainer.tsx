 

import React from 'react';
import { useI18n } from '@/infrastructure/i18n';
import { useActiveNotifications } from '../hooks/useNotificationState';
import { NotificationItem } from './NotificationItem';
import { ProgressNotification } from './ProgressNotification';
import { LoadingNotification } from './LoadingNotification';
import './NotificationContainer.scss';

export const NotificationContainer: React.FC = () => {
  const activeNotifications = useActiveNotifications();
  const { t } = useI18n('common');

  
  
  const visibleNotifications = activeNotifications.filter(
    n => n.variant !== 'silent'
  );

  if (visibleNotifications.length === 0) {
    return null;
  }

  return (
    <div
      className="notification-container"
      role="region"
      aria-label={t('nav.notifications')}
      aria-live="polite"
      aria-relevant="additions text"
    >
      {visibleNotifications.map((notification) => {
        
        if (notification.variant === 'progress') {
          return (
            <ProgressNotification
              key={notification.id}
              notification={notification}
            />
          );
        }

        if (notification.variant === 'loading') {
          return (
            <LoadingNotification
              key={notification.id}
              notification={notification}
            />
          );
        }

        return (
          <NotificationItem
            key={notification.id}
            notification={notification}
          />
        );
      })}
    </div>
  );
};

