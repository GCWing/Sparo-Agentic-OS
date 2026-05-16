import type { BaseToolCardProps } from './BaseToolCard';

export type ToolCardStatus = BaseToolCardProps['status'];

export function isToolStatusLoading(status: ToolCardStatus): boolean {
  return status === 'preparing' ||
    status === 'streaming' ||
    status === 'receiving' ||
    status === 'running' ||
    status === 'analyzing';
}

export function isToolStatusTerminal(status: ToolCardStatus): boolean {
  return status === 'completed' ||
    status === 'cancelled' ||
    status === 'error' ||
    status === 'confirmed';
}
