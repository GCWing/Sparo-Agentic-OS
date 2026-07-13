import React from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
import { DotMatrixLoader, FloatingCard } from '@/design-system';
import { useI18n } from '@/infrastructure/i18n';
import { Notification } from '../types';
import { notificationService } from '../services/NotificationService';
import './LoadingNotification.scss';

export interface LoadingNotificationProps {
  notification: Notification;
}

export const LoadingNotification: React.FC<LoadingNotificationProps> = ({ notification }) => {
  const { id, title, message, cancellable, onCancel, status } = notification;
  const { t } = useI18n('common');

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    }
    notificationService.update(id, { status: 'cancelled' });
    setTimeout(() => notificationService.dismiss(id), 800);
  };

  const getStatusIcon = () => {
    if (status === 'completed') {
      return <CheckCircle size={16} className="loading-notification__status-icon loading-notification__status-icon--success" />;
    }
    if (status === 'failed') {
      return <XCircle size={16} className="loading-notification__status-icon loading-notification__status-icon--error" />;
    }
    return <DotMatrixLoader size="tiny" className="loading-notification__spinner" />;
  };

  return (
    <FloatingCard
      className={`loading-notification loading-notification--${status || 'active'}`}
      padding="compact"
      onDismiss={cancellable && status === 'active' ? handleCancel : undefined}
      dismissLabel={t('actions.cancel')}
      dismissTooltip={t('actions.cancel')}
      role="status"
      aria-live="polite"
    >
      <div className="loading-notification__icon">
        {getStatusIcon()}
      </div>

      <div className="loading-notification__content">
        <div className="loading-notification__title">{title}</div>
        <div className="loading-notification__message">{message}</div>
      </div>

    </FloatingCard>
  );
};
