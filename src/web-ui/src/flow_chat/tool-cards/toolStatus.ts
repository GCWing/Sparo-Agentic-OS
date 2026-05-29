import type { BaseToolCardProps } from './BaseToolCard';
import type { FlowToolItem } from '../types/flow-chat';
import { getToolViewState, type ToolViewState } from '../runtime/toolViewState';

export type ToolCardStatus = BaseToolCardProps['status'];

export function getToolCardStatusFromViewState(viewState: ToolViewState): ToolCardStatus {
  switch (viewState.phase) {
    case 'receiving_input':
      return 'receiving';
    case 'confirming':
      return 'pending_confirmation';
    case 'running':
      return 'running';
    case 'ready':
      return 'confirmed';
    case 'result':
      return 'completed';
    case 'cancelled':
    case 'interrupted':
      return 'cancelled';
    case 'error':
      return 'error';
    case 'preparing':
    default:
      return 'preparing';
  }
}

export function isToolItemLoading(tool: FlowToolItem): boolean {
  return getToolViewState(tool).isLive;
}

export function isToolItemTerminal(tool: FlowToolItem): boolean {
  return getToolViewState(tool).isTerminal;
}

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

export function isToolStatusFailed(status: ToolCardStatus): boolean {
  return status === 'error';
}

export function isToolStatusSuccessful(status: ToolCardStatus): boolean {
  return status === 'completed' || status === 'confirmed';
}

export function isToolStatusStopped(status: ToolCardStatus): boolean {
  return status === 'error' || status === 'cancelled';
}
