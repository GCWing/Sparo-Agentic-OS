import type { FlowToolItem } from '../types/flow-chat';
import { deriveToolRuntimeState, isRuntimeTerminalState } from './statusModel';

export type ToolPresentationPhase =
  | 'preparing'
  | 'receiving_input'
  | 'ready'
  | 'confirming'
  | 'running'
  | 'result'
  | 'cancelled'
  | 'error'
  | 'interrupted';

export interface ToolViewState {
  phase: ToolPresentationPhase;
  canConfirm: boolean;
  canReject: boolean;
  isLive: boolean;
  isTerminal: boolean;
  title: string;
  detail?: string;
}

export function getToolViewState(tool: FlowToolItem): ToolViewState {
  const runtime = deriveToolRuntimeState(tool);
  const isTerminal = isRuntimeTerminalState(runtime.lifecycle);
  const canConfirm = runtime.lifecycle === 'waiting_confirmation' && runtime.confirmation === 'required';
  const canReject = canConfirm;
  const title = tool.toolName || 'Tool';
  const detail = typeof runtime.error === 'string' ? runtime.error : undefined;

  if (tool.interruptionReason === 'app_restart' && runtime.lifecycle === 'cancelled') {
    return {
      phase: 'interrupted',
      canConfirm: false,
      canReject: false,
      isLive: false,
      isTerminal: true,
      title,
      detail,
    };
  }

  if (runtime.lifecycle === 'completed') {
    return { phase: 'result', canConfirm, canReject, isLive: false, isTerminal: true, title, detail };
  }
  if (runtime.lifecycle === 'cancelled') {
    return { phase: 'cancelled', canConfirm, canReject, isLive: false, isTerminal: true, title, detail };
  }
  if (runtime.lifecycle === 'error') {
    return { phase: 'error', canConfirm, canReject, isLive: false, isTerminal: true, title, detail };
  }
  if (runtime.lifecycle === 'waiting_confirmation') {
    return { phase: 'confirming', canConfirm, canReject, isLive: true, isTerminal, title, detail };
  }
  if (runtime.lifecycle === 'running') {
    return { phase: 'running', canConfirm, canReject, isLive: true, isTerminal, title, detail };
  }
  if (runtime.inputPhase === 'streaming') {
    return { phase: 'receiving_input', canConfirm, canReject, isLive: true, isTerminal, title, detail };
  }
  if (runtime.lifecycle === 'ready') {
    return { phase: 'ready', canConfirm, canReject, isLive: true, isTerminal, title, detail };
  }
  return { phase: 'preparing', canConfirm, canReject, isLive: true, isTerminal, title, detail };
}
