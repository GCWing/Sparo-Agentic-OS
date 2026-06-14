import type { DialogTurn, FlowToolItem, Session } from '../types/flow-chat';
import { deriveToolRuntimeState, isRuntimeTerminalState } from '../runtime/statusModel';

export const OS_HANDOFF_INTENT_SOURCE = 'delegate_to_os';

export type OsHandoffStatus =
  | 'deciding'
  | 'creating_work'
  | 'work_created'
  | 'needs_input'
  | 'dialog'
  | 'failed'
  | 'cancelled';

export interface OsHandoffState {
  status: OsHandoffStatus;
}

export type ComposerOsHandoffStatus = Exclude<OsHandoffStatus, 'work_created' | 'dialog'>;

export interface ComposerOsHandoffState {
  status: ComposerOsHandoffStatus;
}

export interface OsHandoffMetadata {
  intentSource: typeof OS_HANDOFF_INTENT_SOURCE;
  handoffRequestId: string;
  objective: string;
  source: 'new_work_dialog';
  createdAt: number;
}

function createHandoffRequestId(): string {
  return `handoff_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function createOsHandoffMetadata(objective: string): OsHandoffMetadata {
  return {
    intentSource: OS_HANDOFF_INTENT_SOURCE,
    handoffRequestId: createHandoffRequestId(),
    objective,
    source: 'new_work_dialog',
    createdAt: Date.now(),
  };
}

export function isOsHandoffMessage(message: DialogTurn['userMessage'] | undefined): boolean {
  return message?.metadata?.intentSource === OS_HANDOFF_INTENT_SOURCE;
}

function collectToolItems(turn: DialogTurn): FlowToolItem[] {
  const tools: FlowToolItem[] = [];
  for (const round of turn.modelRounds) {
    for (const item of round.items) {
      if (item.type === 'tool') {
        tools.push(item as FlowToolItem);
      }
    }
  }
  return tools;
}

function latestNamedTool(tools: FlowToolItem[], toolName: string): FlowToolItem | null {
  const normalized = toolName.toLowerCase();
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    if ((tools[index].toolName ?? '').trim().toLowerCase() === normalized) {
      return tools[index];
    }
  }
  return null;
}

export function deriveOsHandoffTurnState(turn: DialogTurn): OsHandoffState | null {
  if (!isOsHandoffMessage(turn.userMessage)) {
    return null;
  }

  const tools = collectToolItems(turn);
  const workTool = latestNamedTool(tools, 'Work');
  if (workTool) {
    const lifecycle = deriveToolRuntimeState(workTool).lifecycle;
    if (lifecycle === 'error') return { status: 'failed' };
    if (lifecycle === 'cancelled') return { status: 'cancelled' };
    if (isRuntimeTerminalState(lifecycle)) return { status: 'work_created' };
    return { status: 'creating_work' };
  }

  const askUserTool = latestNamedTool(tools, 'AskUserQuestion');
  if (askUserTool) {
    const lifecycle = deriveToolRuntimeState(askUserTool).lifecycle;
    if (!isRuntimeTerminalState(lifecycle)) {
      return { status: 'needs_input' };
    }
  }

  switch (turn.status) {
    case 'completed':
      return { status: 'dialog' };
    case 'cancelled':
    case 'cancelling':
      return { status: 'cancelled' };
    case 'error':
      return { status: 'failed' };
    default:
      return { status: 'deciding' };
  }
}

export function deriveComposerOsHandoffState(
  session: Pick<Session, 'dialogTurns'> | null | undefined,
): ComposerOsHandoffState | null {
  const turns = session?.dialogTurns;
  const latestTurn = turns && turns.length > 0 ? turns[turns.length - 1] : undefined;
  if (!latestTurn) {
    return null;
  }

  const state = deriveOsHandoffTurnState(latestTurn);
  if (!state || state.status === 'work_created' || state.status === 'dialog') {
    return null;
  }

  return { status: state.status };
}
