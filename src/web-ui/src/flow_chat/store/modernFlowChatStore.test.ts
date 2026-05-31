import { describe, expect, it } from 'vitest';
import {
  getDispatcherTimelineProjection,
  getDispatcherTimelineSignature,
  getProjectionVersion,
  getTaskExecutionVirtualItems,
  sessionToVirtualItems,
} from '../projections/flowChatProjectionScheduler';
import type { DialogTurn, FlowChatState, FlowSubagentExecutionProjection, Session } from '../types/flow-chat';

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

  it('exposes a stable projection version for recompute checks', () => {
    const firstTurn = createTurn('turn-version-1', 'first');
    const initialSession = createSession([firstTurn]);
    sessionToVirtualItems(initialSession);
    const initialVersion = getProjectionVersion(initialSession.sessionId);

    sessionToVirtualItems(initialSession);
    expect(getProjectionVersion(initialSession.sessionId)).toBe(initialVersion);

    const updatedTurn = {
      ...firstTurn,
      userMessage: {
        ...firstTurn.userMessage!,
        content: 'first updated',
      },
    } as DialogTurn;

    sessionToVirtualItems(createSession([updatedTurn]));
    expect(getProjectionVersion(initialSession.sessionId)).toBe(initialVersion + 1);
  });
});

function createFlowChatState(sessions: Session[], activeSessionId: string | null = null): FlowChatState {
  return {
    sessions: new Map(sessions.map(session => [session.sessionId, session])),
    activeSessionId,
    currentMode: 'chat',
    isLoading: false,
    activeToolExecutions: new Set(),
    recentCompletions: new Set(),
    sessionNeedsAttention: new Map(),
    userScrolledSessions: new Set(),
    unreadCompletions: new Map(),
    persistedUnreadCompletions: new Map(),
  } as unknown as FlowChatState;
}

function createDispatcherSession(overrides: Partial<Session> = {}): Session {
  return {
    ...createSession([createTurn('dispatcher-turn-1', 'Plan the next step')]),
    sessionId: overrides.sessionId ?? 'dispatcher-session-1',
    mode: 'dispatcher',
    title: 'Dispatcher plan',
    lastActiveAt: 1,
    lastFinishedAt: 1,
    ...overrides,
  } as Session;
}

describe('dispatcher timeline projection', () => {
  it('is owned by the projection scheduler and ignores assistant-only streaming churn', () => {
    const dispatcherSession = createDispatcherSession();
    const initialState = createFlowChatState([dispatcherSession], dispatcherSession.sessionId);

    const initialTimeline = getDispatcherTimelineProjection(initialState);
    const initialVersion = getProjectionVersion('dispatcherTimeline');
    const initialSignature = getDispatcherTimelineSignature(initialState);

    const streamingOnlyState = createFlowChatState([
      {
        ...dispatcherSession,
        dialogTurns: [
          {
            ...dispatcherSession.dialogTurns[0],
            modelRounds: [
              {
                id: 'round-1',
                items: [
                  {
                    id: 'text-1',
                    type: 'text',
                    content: 'streaming assistant text',
                  },
                ],
              },
            ] as any,
          },
        ],
      } as Session,
    ], dispatcherSession.sessionId);

    expect(getDispatcherTimelineSignature(streamingOnlyState)).toBe(initialSignature);
    expect(getDispatcherTimelineProjection(streamingOnlyState)).toBe(initialTimeline);
    expect(getProjectionVersion('dispatcherTimeline')).toBe(initialVersion);

    const metadataState = createFlowChatState([
      {
        ...dispatcherSession,
        title: 'Updated dispatcher plan',
      } as Session,
    ], dispatcherSession.sessionId);

    const updatedTimeline = getDispatcherTimelineProjection(metadataState);
    expect(updatedTimeline).not.toBe(initialTimeline);
    expect(getProjectionVersion('dispatcherTimeline')).toBe(initialVersion + 1);
  });
});

describe('task execution projection', () => {
  it('exposes task detail items through the projection scheduler facade', () => {
    const projection = {
      id: 'session-1:task-1',
      kind: 'subagentRun',
      edgeKind: 'delegates',
      parentSessionId: 'session-1',
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
    } as FlowSubagentExecutionProjection;

    const items = getTaskExecutionVirtualItems(projection);
    const initialVersion = getProjectionVersion(`taskExecution:${projection.id}`);

    expect(items).toBe(projection.items);
    expect(getTaskExecutionVirtualItems(projection)).toBe(items);
    expect(getProjectionVersion(`taskExecution:${projection.id}`)).toBe(initialVersion);

    const updatedProjection = {
      ...projection,
      items: [...projection.items],
    };

    expect(getTaskExecutionVirtualItems(updatedProjection)).toBe(updatedProjection.items);
    expect(getProjectionVersion(`taskExecution:${projection.id}`)).toBe(initialVersion + 1);
  });
});
