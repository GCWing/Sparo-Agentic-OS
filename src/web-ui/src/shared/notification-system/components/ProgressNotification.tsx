import React from 'react';
import { CheckCircle, X, XCircle } from 'lucide-react';
import { DotMatrixLoader, IconButton } from '@/design-system';
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
    notificationService.update(id, { status: 'cancelled' });
    setTimeout(() => notificationService.dismiss(id), 800);
  };

  const getStatusIcon = () => {
    if (status === 'completed') {
      return <CheckCircle size={16} className="progress-notification__status-icon progress-notification__status-icon--success" />;
    }
    if (status === 'failed') {
      return <XCircle size={16} className="progress-notification__status-icon progress-notification__status-icon--error" />;
    }
    return <DotMatrixLoader size="tiny" className="progress-notification__spinner" />;
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
    <div
      className={`progress-notification progress-notification--${status || 'active'} ${mode === 'text-only' ? 'progress-notification--text-only' : ''}`}
      role="status"
      aria-live="polite"
    >
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
          <div
            className="progress-notification__progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
            aria-label={title}
          >
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
