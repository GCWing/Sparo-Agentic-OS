import { describe, expect, it } from 'vitest';
import { executionGraphStore } from '../execution';
import { FlowChatStore } from './FlowChatStore';
import type { DialogTurn, FlowSubagentExecutionProjection, FlowToolItem } from '../types/flow-chat';

type ProjectionTestBridge = {
  convertToDialogTurns: (turns: unknown[]) => DialogTurn[];
  hydrateExecutionProjections: (dialogTurns: DialogTurn[]) => Promise<void>;
};

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
