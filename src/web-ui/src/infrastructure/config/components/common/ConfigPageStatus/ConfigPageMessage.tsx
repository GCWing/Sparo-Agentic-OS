import React from 'react';
import { Alert } from '@/design-system';
import './ConfigPage.scss';

export interface ConfigPageMessageData {
  type: 'success' | 'error' | 'info' | 'warning';
  text: string;
}

export interface ConfigPageMessageProps {
  message: ConfigPageMessageData | null;
  className?: string;
}

export const ConfigPageMessage: React.FC<ConfigPageMessageProps> = ({
  message,
  className = '',
}) => {
  if (!message) return null;

  return (
    <div className={`bitfun-config-page-message ${className}`}>
      <Alert type={message.type} message={message.text} />
    </div>
  );
};

