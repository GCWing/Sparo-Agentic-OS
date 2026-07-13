 

import React from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info } from 'lucide-react';
import { Button, FloatingCard } from '@/design-system';
import { useI18n } from '@/infrastructure/i18n';
import { Notification } from '../types';
import { notificationService } from '../services/NotificationService';
import './NotificationItem.scss';

export interface NotificationItemProps {
  notification: Notification;
}

export const NotificationItem: React.FC<NotificationItemProps> = ({ notification }) => {
  const { id, type, title, message, messageNode, closable, actions } = notification;
  const { t } = useI18n('common');

  
  const getIcon = () => {
    switch (type) {
      case 'success':
        return <CheckCircle size={14} />;
      case 'error':
        return <XCircle size={14} />;
      case 'warning':
        return <AlertTriangle size={14} />;
      case 'info':
      default:
        return <Info size={14} />;
    }
  };

  
  const handleClose = () => {
    notificationService.dismiss(id);
  };

  
  const handleAction = (onClick: () => void) => {
    onClick();
    
    if (closable) {
      notificationService.dismiss(id);
    }
  };

  return (
    <FloatingCard
      className={`notification-item notification-item--${type}`}
      padding="compact"
      onDismiss={closable ? handleClose : undefined}
      dismissLabel={t('actions.close')}
      dismissTooltip={t('actions.close')}
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
    >
      
      <div className="notification-item__icon">
        {getIcon()}
      </div>

      
      <div className="notification-item__content">
        <div className="notification-item__title">{title}</div>
        <div className="notification-item__message">{messageNode ?? message}</div>

        
        {actions && actions.length > 0 && (
          <div className="notification-item__actions">
            {actions.map((action, index) => (
              <Button
                key={index}
                className="notification-item__action"
                variant={action.variant === 'primary' ? 'primary' : action.variant === 'danger' ? 'danger' : 'secondary'}
                size="small"
                onClick={() => handleAction(action.onClick)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </div>

      
    </FloatingCard>
  );
};

