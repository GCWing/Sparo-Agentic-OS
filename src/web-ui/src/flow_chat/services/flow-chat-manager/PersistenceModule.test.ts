import { describe, expect, it } from 'vitest';
import { convertDialogTurnToBackendFormat } from './PersistenceModule';
import type { DialogTurn, FlowSubagentExecutionProjection } from '../../types/flow-chat';

describe('convertDialogTurnToBackendFormat', () => {
  it('persists subagent execution projection on the parent Task tool only', () => {
    const projection: FlowSubagentExecutionProjection = {
      id: 'session-1:task-1',
      kind: 'subagentRun',
      edgeKind: 'delegates',
      parentSessionId: 'session-1',
      parentTurnId: 'turn-1',
      parentToolId: 'task-1',
      childSessionId: 'child-1',
      items: [
        {
          id: 'subagent-text-1',
          type: 'text',
          content: 'child detail',
          isStreaming: false,
          isMarkdown: true,
          timestamp: 2,
          status: 'completed',
        },
      ],
      summary: {
        status: 'completed',
        latestLabel: 'child detail',
        updatedAt: 3,
      },
      createdAt: 1,
      updatedAt: 3,
    };

    const turn: DialogTurn = {
      id: 'turn-1',
      sessionId: 'session-1',
      userMessage: {
        id: 'user-1',
        content: 'delegate',
        timestamp: 1,
      },
      modelRounds: [
        {
          id: 'round-1',
          index: 0,
          items: [
            {
              id: 'task-1',
              type: 'tool',
              toolName: 'Task',
              toolCall: {
                id: 'task-1',
                input: {
                  subagent_type: 'Explore',
                  prompt: 'inspect',
                },
              },
              timestamp: 1,
              status: 'completed',
              startTime: 1,
              endTime: 4,
              executionProjection: projection,
            },
          ],
          isStreaming: false,
          isComplete: true,
          status: 'completed',
          startTime: 1,
          endTime: 4,
        },
      ],
      status: 'completed',
      startTime: 1,
      endTime: 4,
    };

    const backend = convertDialogTurnToBackendFormat(turn, 0);
    const taskTool = backend.modelRounds[0].toolItems[0];

    expect(taskTool.executionProjection).toEqual(projection);
  });
});
