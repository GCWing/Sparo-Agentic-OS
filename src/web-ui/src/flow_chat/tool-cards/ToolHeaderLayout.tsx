import React from 'react';
import { ToolCardHeader, type ToolCardHeaderProps } from './BaseToolCard';
import { CompactToolCardHeader, type CompactToolCardHeaderProps } from './CompactToolCard';
import { ToolStatusIndicator, type ToolCardStatus } from './ToolStatusIndicator';

export interface ToolHeaderLayoutProps extends Omit<ToolCardHeaderProps, 'statusIcon'> {
  status?: ToolCardStatus;
  statusIcon?: React.ReactNode;
  loadingStyle?: 'spinner' | 'cube';
}

export const ToolHeaderLayout: React.FC<ToolHeaderLayoutProps> = ({
  status,
  statusIcon,
  loadingStyle = 'cube',
  ...props
}) => {
  return (
    <ToolCardHeader
      {...props}
      statusIcon={statusIcon ?? (status ? <ToolStatusIndicator status={status} loadingStyle={loadingStyle} /> : undefined)}
    />
  );
};

export interface ToolCompactHeaderLayoutProps extends Omit<CompactToolCardHeaderProps, 'statusIcon'> {
  status?: ToolCardStatus;
  statusIcon?: React.ReactNode;
}

export const ToolCompactHeaderLayout: React.FC<ToolCompactHeaderLayoutProps> = ({
  status,
  statusIcon,
  ...props
}) => {
  return (
    <CompactToolCardHeader
      {...props}
      statusIcon={statusIcon ?? (status ? <ToolStatusIndicator status={status} size={12} /> : undefined)}
    />
  );
};
