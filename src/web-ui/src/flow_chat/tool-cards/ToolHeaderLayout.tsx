import React from 'react';
import { ToolCardHeader, type ToolCardHeaderProps } from './BaseToolCard';
import { CompactToolCardHeader, type CompactToolCardHeaderProps } from './CompactToolCard';
import { ToolStatusIndicator } from './ToolStatusIndicator';
import type { ToolCardStatus } from './toolStatus';

export interface ToolHeaderLayoutProps extends Omit<ToolCardHeaderProps, 'statusIcon'> {
  status?: ToolCardStatus;
  statusIcon?: React.ReactNode;
}

export const ToolHeaderLayout: React.FC<ToolHeaderLayoutProps> = ({
  status,
  statusIcon,
  ...props
}) => {
  return (
    <ToolCardHeader
      {...props}
      statusIcon={statusIcon ?? (status ? <ToolStatusIndicator status={status} /> : undefined)}
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
