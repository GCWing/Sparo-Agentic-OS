import { describe, expect, it } from 'vitest';
import type { DialogTurn, FlowToolItem, ModelRound, Session } from '../types/flow-chat';
import {
  deriveComposerOsHandoffState,
  OS_HANDOFF_INTENT_SOURCE,
} from './osHandoffIntent';

function makeTool(status: FlowToolItem['status']): FlowToolItem {
  return {
    id: `tool-${status}`,
    type: 'tool',
    timestamp: 2,
    status,
    toolName: 'Work',
    toolCall: {
      id: `call-${status}`,
      input: { action: 'start' },
    },
    toolResult: status === 'completed'
      ? {
        result: { action: 'start', work_id: 'work-1' },
        success: true,
      }
      : undefined,
  };
}

function makeRound(items: FlowToolItem[]): ModelRound {
  return {
    id: 'round-1',
    index: 0,
    items,
    isStreaming: false,
    isComplete: items.every(item => item.status === 'completed'),
    status: items.every(item => item.status === 'completed') ? 'completed' : 'streaming',
    startTime: 1,
  };
}

function makeTurn({
  metadata = { intentSource: OS_HANDOFF_INTENT_SOURCE },
  status = 'processing',
  tools = [],
}: {
  metadata?: Record<string, unknown>;
  status?: DialogTurn['status'];
  tools?: FlowToolItem[];
} = {}): DialogTurn {
  return {
    id: 'turn-1',
    sessionId: 'session-1',
    userMessage: {
      id: 'message-1',
      content: 'hand this to OS',
      timestamp: 1,
      metadata,
    },
    modelRounds: tools.length > 0 ? [makeRound(tools)] : [],
    status,
    startTime: 1,
  };
}

function makeSession(dialogTurns: DialogTurn[]): Pick<Session, 'dialogTurns'> {
  return { dialogTurns };
}

describe('deriveComposerOsHandoffState', () => {
  it('shows deciding for the latest delegate_to_os turn before Work starts', () => {
    expect(deriveComposerOsHandoffState(makeSession([makeTurn()]))).toEqual({
      status: 'deciding',
    });
  });

  it('shows creating_work while the Work tool is running', () => {
    expect(
      deriveComposerOsHandoffState(makeSession([
        makeTurn({ tools: [makeTool('running')] }),
      ])),
    ).toEqual({
      status: 'creating_work',
    });
  });

  it('hides composer state after the Work tool completes', () => {
    expect(
      deriveComposerOsHandoffState(makeSession([
        makeTurn({ tools: [makeTool('completed')] }),
      ])),
    ).toBeNull();
  });

  it('ignores older handoff turns when the latest turn is not a handoff', () => {
    expect(
      deriveComposerOsHandoffState(makeSession([
        makeTurn({ tools: [makeTool('running')] }),
        makeTurn({ metadata: { intentSource: 'desktop_ui' } }),
      ])),
    ).toBeNull();
  });
});
