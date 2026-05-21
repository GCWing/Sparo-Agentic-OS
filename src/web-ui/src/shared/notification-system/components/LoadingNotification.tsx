import React from 'react';
import { CheckCircle, Loader2, X, XCircle } from 'lucide-react';
import { IconButton } from '@/design-system';
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
    return <Loader2 size={16} className="loading-notification__spinner" />;
  };

  return (
    <div
      className={`loading-notification loading-notification--${status || 'active'}`}
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

      {cancellable && status === 'active' && (
        <IconButton
          className="loading-notification__cancel"
          onClick={handleCancel}
          aria-label={t('actions.cancel')}
          tooltip={t('actions.cancel')}
          size="xs"
          variant="ghost"
        >
          <X size={14} />
        </IconButton>
      )}
    </div>
  );
};
