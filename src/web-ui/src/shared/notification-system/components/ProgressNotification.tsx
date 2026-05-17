import React from 'react';
import { CheckCircle, Loader2, X, XCircle } from 'lucide-react';
import { IconButton } from '@/design-system';
import { useI18n } from '@/infrastructure/i18n';
import { Notification } from '../types';
import { notificationService } from '../services/NotificationService';
import './ProgressNotification.scss';

export interface ProgressNotificationProps {
  notification: Notification;
}

export const ProgressNotification: React.FC<ProgressNotificationProps> = ({ notification }) => {
  const { id, title, message, progress = 0, progressText, progressMode, current, total, textOnly, cancellable, onCancel, status } = notification;
  const { t } = useI18n('common');

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    }
    notificationService.dismiss(id);
  };

  const getStatusIcon = () => {
    if (status === 'completed') {
      return <CheckCircle size={16} className="progress-notification__status-icon progress-notification__status-icon--success" />;
    }
    if (status === 'failed') {
      return <XCircle size={16} className="progress-notification__status-icon progress-notification__status-icon--error" />;
    }
    return <Loader2 size={16} className="progress-notification__spinner" />;
  };

  const mode = progressMode || (textOnly ? 'text-only' : 'percentage');
  const shouldShowProgressBar = mode !== 'text-only';
  const shouldShowIndicator = mode !== 'text-only';

  const getProgressIndicator = () => {
    if (mode === 'fraction' && current !== undefined && total !== undefined) {
      return `${current}/${total}`;
    }
    if (mode === 'percentage') {
      return `${Math.round(progress)}%`;
    }
    return null;
  };

  return (
    <div className={`progress-notification progress-notification--${status || 'active'} ${mode === 'text-only' ? 'progress-notification--text-only' : ''}`}>
      <div className="progress-notification__icon">
        {getStatusIcon()}
      </div>

      <div className="progress-notification__content">
        <div className="progress-notification__header">
          <div className="progress-notification__title">{title}</div>

          {shouldShowIndicator && (
            <div className="progress-notification__percentage">{getProgressIndicator()}</div>
          )}
        </div>

        <div className="progress-notification__message">
          {progressText || message}
        </div>

        {shouldShowProgressBar && (
          <div className="progress-notification__progress-bar">
            <div
              className="progress-notification__progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      {cancellable && status === 'active' && (
        <IconButton
          className="progress-notification__cancel"
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
