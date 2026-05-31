import { describe, expect, it } from 'vitest';
import type { FlowChatState, Session } from '../types/flow-chat';
import { getSessionNavigationSignature } from './sessionNavigationSignature';

function createSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: 'session-1',
    title: 'Initial task',
    dialogTurns: [
      {
        id: 'turn-1',
        sessionId: 'session-1',
        userMessage: {
          id: 'user-1',
          content: 'hello',
          timestamp: 1,
        },
        modelRounds: [
          {
            id: 'round-1',
            index: 1,
            items: [
              {
                id: 'text-1',
                type: 'text',
                content: 'streaming',
                isStreaming: true,
                isMarkdown: true,
                timestamp: 2,
                status: 'streaming',
              },
            ],
            isStreaming: true,
            isComplete: false,
            status: 'streaming',
            startTime: 2,
          },
        ],
        startTime: 1,
      },
    ],
    status: 'active',
    config: {},
    createdAt: 1,
    lastActiveAt: 1,
    error: null,
    sessionKind: 'normal',
    ...overrides,
  };
}

function createState(session: Session, activeSessionId = 'session-1'): FlowChatState {
  return {
    activeSessionId,
    sessions: new Map([[session.sessionId, session]]),
  };
}

describe('getSessionNavigationSignature', () => {
  it('ignores assistant streaming content churn', () => {
    const initial = createSession();
    const changedContent = createSession({
      dialogTurns: [
        {
          ...initial.dialogTurns[0],
          modelRounds: [
            {
              ...initial.dialogTurns[0].modelRounds[0],
              items: [
                {
                  ...initial.dialogTurns[0].modelRounds[0].items[0],
                  content: 'streaming markdown content with more tokens',
                },
              ],
            },
          ],
        },
      ],
    });

    expect(getSessionNavigationSignature(createState(changedContent))).toBe(
      getSessionNavigationSignature(createState(initial))
    );
  });

  it('changes when navigation metadata changes', () => {
    const initial = createSession();
    const renamed = createSession({ title: 'Renamed task' });

    expect(getSessionNavigationSignature(createState(renamed))).not.toBe(
      getSessionNavigationSignature(createState(initial))
    );
    expect(getSessionNavigationSignature(createState(initial, 'other-session'))).not.toBe(
      getSessionNavigationSignature(createState(initial))
    );
  });
});
