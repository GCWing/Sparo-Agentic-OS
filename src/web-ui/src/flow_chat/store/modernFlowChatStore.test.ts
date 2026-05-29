import { describe, expect, it } from 'vitest';
import { sessionToVirtualItems } from './modernFlowChatStore';
import type { DialogTurn, Session } from '../types/flow-chat';

function createTurn(id: string, content: string): DialogTurn {
  return {
    id,
    userMessage: {
      id: `user-${id}`,
      type: 'user',
      content,
      timestamp: 1,
    },
    modelRounds: [],
    status: 'completed',
    startTime: 1,
  } as DialogTurn;
}

function createSession(dialogTurns: DialogTurn[]): Session {
  return {
    sessionId: 'session-1',
    dialogTurns,
    mode: 'agentic',
    workspacePath: 'D:/workspace/example',
    createdAt: 1,
    updatedAt: 1,
  } as Session;
}

describe('sessionToVirtualItems', () => {
  it('reuses unchanged turn virtual items when another turn updates', () => {
    const firstTurn = createTurn('turn-1', 'first');
    const secondTurn = createTurn('turn-2', 'second');
    const initialItems = sessionToVirtualItems(createSession([firstTurn, secondTurn]));

    const updatedSecondTurn = {
      ...secondTurn,
      userMessage: {
        ...secondTurn.userMessage!,
        content: 'second updated',
      },
    } as DialogTurn;
    const nextItems = sessionToVirtualItems(createSession([firstTurn, updatedSecondTurn]));

    expect(nextItems[0]).toBe(initialItems[0]);
    expect(nextItems[1]).not.toBe(initialItems[1]);
  });
});
