import { describe, expect, it } from 'vitest';
import { executionGraphStore } from '../execution';
import { FlowChatStore } from './FlowChatStore';
import type { DialogTurn, FlowSubagentExecutionProjection, FlowToolItem } from '../types/flow-chat';

type ProjectionTestBridge = {
  convertToDialogTurns: (turns: unknown[]) => DialogTurn[];
  hydrateExecutionProjections: (dialogTurns: DialogTurn[]) => Promise<void>;
  mergeHydratedDialogTurns: (
    existingDialogTurns: DialogTurn[],
    persistedDialogTurns: DialogTurn[]
  ) => DialogTurn[];
};

function createDialogTurn(
  id: string,
  status: DialogTurn['status'],
  startTime: number,
  content = id
): DialogTurn {
  return {
    id,
    sessionId: 'merge-session',
    userMessage: {
      id: `user-${id}`,
      type: 'user',
      content,
      timestamp: startTime,
    },
    modelRounds: [],
    status,
    startTime,
  } as DialogTurn;
}

describe('FlowChatStore subagent projection recovery', () => {
  it('recovers parent Task execution projections from persisted session history', async () => {
    const projection: FlowSubagentExecutionProjection = {
      id: 'projection-session:projection-task',
      kind: 'subagentRun',
      edgeKind: 'delegates',
      parentSessionId: 'projection-session',
      parentTurnId: 'projection-turn',
      parentToolId: 'projection-task',
      childSessionId: 'projection-child',
      items: [
        {
          id: 'projection-text',
          type: 'text',
          content: 'Recovered after restart',
          isStreaming: false,
          isMarkdown: true,
          timestamp: 1,
          status: 'completed',
        },
      ],
      summary: {
        status: 'completed',
        latestLabel: 'Recovered after restart',
        updatedAt: 2,
      },
      createdAt: 1,
      updatedAt: 2,
    };

    const persistedTurn = {
      turnId: 'projection-turn',
      sessionId: 'projection-session',
      kind: 'user_dialog',
      userMessage: {
        id: 'user-1',
        content: 'Run subagent',
        timestamp: 1,
        metadata: {},
      },
      modelRounds: [
        {
          id: 'round-1',
          turnId: 'projection-turn',
          roundIndex: 0,
          textItems: [],
          thinkingItems: [],
          toolItems: [
            {
              id: 'projection-task',
              toolName: 'Task',
              toolCall: {
                id: 'projection-task',
                input: {
                  description: 'Recover details',
                  prompt: 'Recover details',
                  subagent_type: 'Explore',
                },
              },
              toolResult: { result: 'done', success: true },
              startTime: 1,
              endTime: 2,
              status: 'completed',
              orderIndex: 0,
              executionProjection: projection,
            },
          ],
          startTime: 1,
          endTime: 2,
          status: 'completed',
          timestamp: 1,
        },
      ],
      timestamp: 1,
      startTime: 1,
      endTime: 2,
      status: 'completed',
      turnIndex: 0,
    };

    const bridge = FlowChatStore.getInstance() as unknown as ProjectionTestBridge;
    const dialogTurns = bridge.convertToDialogTurns([persistedTurn]);
    const recoveredTask = dialogTurns[0].modelRounds[0].items[0] as FlowToolItem;

    expect(recoveredTask.executionProjection).toEqual(projection);

    await bridge.hydrateExecutionProjections(dialogTurns);

    expect(executionGraphStore.getNode('projection-session', 'projection-task')).toEqual(
      expect.objectContaining(projection)
    );
  });
});

describe('FlowChatStore hydrated history merge', () => {
  it('merges persisted history without dropping live local turns', () => {
    const bridge = FlowChatStore.getInstance() as unknown as ProjectionTestBridge;
    const persistedOld = createDialogTurn('turn-old', 'completed', 10, 'persisted old');
    const persistedLive = createDialogTurn('turn-live', 'completed', 20, 'persisted live');
    const existingLive = createDialogTurn('turn-live', 'processing', 20, 'local live');
    const existingNew = createDialogTurn('turn-new', 'pending', 30, 'local new');

    const merged = bridge.mergeHydratedDialogTurns(
      [existingLive, existingNew],
      [persistedOld, persistedLive]
    );

    expect(merged.map(turn => turn.id)).toEqual(['turn-old', 'turn-live', 'turn-new']);
    expect(merged[1]).toBe(existingLive);
    expect(merged[2]).toBe(existingNew);
  });

  it('uses persisted history for terminal turns with the same id', () => {
    const bridge = FlowChatStore.getInstance() as unknown as ProjectionTestBridge;
    const existingTerminal = createDialogTurn('turn-terminal', 'completed', 10, 'local stale');
    const persistedTerminal = createDialogTurn('turn-terminal', 'completed', 10, 'persisted final');

    const merged = bridge.mergeHydratedDialogTurns(
      [existingTerminal],
      [persistedTerminal]
    );

    expect(merged).toEqual([persistedTerminal]);
    expect(merged[0]).toBe(persistedTerminal);
  });
});
