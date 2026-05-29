import type {
  AnyFlowItem,
  DialogTurn,
  FlowTextItem,
  FlowThinkingItem,
  FlowToolItem,
  ModelRound,
} from '../types/flow-chat';

export type RuntimeTerminalState = 'completed' | 'cancelled' | 'error';

export type SessionRuntimeState = 'idle' | 'active' | 'draining' | 'error';

export type DialogTurnState =
  | 'pending'
  | 'preparing_context'
  | 'image_analyzing'
  | 'running'
  | 'draining'
  | 'waiting_confirmation'
  | 'cancelling'
  | RuntimeTerminalState;

export type ModelRoundState =
  | 'pending'
  | 'generating'
  | 'waiting_tool'
  | 'waiting_confirmation'
  | RuntimeTerminalState;

export type TextBlockState = 'streaming' | RuntimeTerminalState;
export type ThinkingBlockState = 'streaming' | RuntimeTerminalState;

export type ToolLifecycle =
  | 'pending'
  | 'preparing'
  | 'ready'
  | 'waiting_confirmation'
  | 'running'
  | RuntimeTerminalState;

export type ToolInputPhase = 'none' | 'streaming' | 'parsed';
export type ToolConfirmationState = 'none' | 'required' | 'approved' | 'rejected';

export interface ToolRuntimeState {
  lifecycle: ToolLifecycle;
  inputPhase: ToolInputPhase;
  confirmation: ToolConfirmationState;
  input: unknown;
  partialInput?: unknown;
  result?: unknown;
  error?: string;
  startedAt?: number;
  endedAt?: number;
}

export type ExecutionNodeStatus =
  | 'preparing'
  | 'running'
  | 'draining'
  | 'waiting_confirmation'
  | RuntimeTerminalState;

export type ExecutionNodeActivity =
  | 'idle'
  | 'thinking'
  | 'streaming_text'
  | 'receiving_tool_input'
  | 'running_tool';

export interface ExecutionNodeState {
  status: ExecutionNodeStatus;
  activity: ExecutionNodeActivity;
  terminalReason?:
    | 'completed'
    | 'user_cancelled'
    | 'parent_cancelled'
    | 'child_error'
    | 'app_restart';
  error?: string;
}

export function isRuntimeTerminalState(state: unknown): state is RuntimeTerminalState {
  return state === 'completed' || state === 'cancelled' || state === 'error';
}

export function deriveDialogTurnState(turn: Pick<DialogTurn, 'status' | 'modelRounds'>): DialogTurnState {
  if (turn.status === 'pending') return 'pending';
  if (turn.status === 'image_analyzing') return 'image_analyzing';
  if (turn.status === 'finishing') return 'draining';
  if (turn.status === 'cancelling') return 'cancelling';
  if (isRuntimeTerminalState(turn.status)) return turn.status;

  const hasPendingConfirmation = turn.modelRounds.some(round =>
    round.items.some(item => item.type === 'tool' && deriveToolRuntimeState(item as FlowToolItem).lifecycle === 'waiting_confirmation')
  );
  return hasPendingConfirmation ? 'waiting_confirmation' : 'running';
}

export function deriveModelRoundState(round: Pick<ModelRound, 'status' | 'items'>): ModelRoundState {
  if (round.status === 'pending') return 'pending';
  if (round.status === 'pending_confirmation') return 'waiting_confirmation';
  if (isRuntimeTerminalState(round.status)) return round.status;

  const hasWaitingConfirmation = round.items.some(item =>
    item.type === 'tool' && deriveToolRuntimeState(item as FlowToolItem).lifecycle === 'waiting_confirmation'
  );
  if (hasWaitingConfirmation) return 'waiting_confirmation';

  const hasRunningTool = round.items.some(item => {
    if (item.type !== 'tool') return false;
    const lifecycle = deriveToolRuntimeState(item as FlowToolItem).lifecycle;
    return lifecycle === 'running' || lifecycle === 'preparing' || lifecycle === 'ready';
  });
  return hasRunningTool ? 'waiting_tool' : 'generating';
}

export function deriveTextBlockState(item: Pick<FlowTextItem, 'status' | 'isStreaming'>): TextBlockState {
  if (isRuntimeTerminalState(item.status)) return item.status;
  return item.isStreaming ? 'streaming' : 'completed';
}

export function deriveThinkingBlockState(item: Pick<FlowThinkingItem, 'status' | 'isStreaming'>): ThinkingBlockState {
  if (isRuntimeTerminalState(item.status)) return item.status;
  return item.isStreaming ? 'streaming' : 'completed';
}

export function deriveToolRuntimeState(tool: FlowToolItem): ToolRuntimeState {
  if (tool.runtime) {
    const fallback = deriveLegacyToolRuntimeState(tool);
    return {
      ...fallback,
      ...tool.runtime,
      result: tool.runtime.result ?? tool.toolResult?.result,
      error: tool.runtime.error ?? tool.toolResult?.error,
      startedAt: tool.runtime.startedAt ?? tool.startTime,
      endedAt: tool.runtime.endedAt ?? tool.endTime,
    };
  }

  return deriveLegacyToolRuntimeState(tool);
}

function deriveLegacyToolRuntimeState(tool: FlowToolItem): ToolRuntimeState {
  const status = tool.status as string;
  const hasResult = tool.toolResult !== undefined;
  const inputPhase: ToolInputPhase = tool.toolCall?.input !== undefined ? 'parsed' : 'none';
  const confirmation: ToolConfirmationState =
    tool.userConfirmed === true
      ? 'approved'
      : tool.userConfirmed === false || status === 'rejected'
        ? 'rejected'
        : tool.requiresConfirmation || status === 'pending_confirmation'
          ? 'required'
          : 'none';

  let lifecycle: ToolLifecycle;
  if (status === 'pending') lifecycle = 'pending';
  else if (status === 'preparing' || status === 'streaming' || status === 'receiving') lifecycle = 'preparing';
  else if (status === 'pending_confirmation') lifecycle = 'waiting_confirmation';
  else if (status === 'confirmed') lifecycle = 'ready';
  else if (status === 'running') lifecycle = 'running';
  else if (status === 'completed') lifecycle = 'completed';
  else if (status === 'cancelled' || status === 'rejected') lifecycle = 'cancelled';
  else if (status === 'error') lifecycle = 'error';
  else lifecycle = hasResult ? (tool.toolResult?.success === false ? 'error' : 'completed') : 'preparing';

  if (confirmation === 'rejected') {
    lifecycle = 'cancelled';
  }

  return {
    lifecycle,
    inputPhase,
    confirmation,
    input: tool.toolCall?.input,
    result: tool.toolResult?.result,
    error: tool.toolResult?.error,
    startedAt: tool.startTime,
    endedAt: tool.endTime,
  };
}

export function isFlowItemTerminal(item: AnyFlowItem): boolean {
  if (item.type === 'tool') {
    return isRuntimeTerminalState(deriveToolRuntimeState(item as FlowToolItem).lifecycle);
  }
  return isRuntimeTerminalState(item.status);
}

export function isDialogTurnTerminal(turn: Pick<DialogTurn, 'status'>): boolean {
  return isRuntimeTerminalState(turn.status);
}

export function isModelRoundTerminal(round: Pick<ModelRound, 'status'>): boolean {
  return isRuntimeTerminalState(round.status);
}

export function isToolTerminal(tool: FlowToolItem): boolean {
  return isRuntimeTerminalState(deriveToolRuntimeState(tool).lifecycle);
}
