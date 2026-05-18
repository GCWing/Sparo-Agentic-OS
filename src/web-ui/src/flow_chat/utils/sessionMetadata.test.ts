import { describe, expect, it, vi } from 'vitest';
import type { Session } from '../types/flow-chat';
import type { SessionMetadata } from '@/shared/types/session-history';

vi.mock('@/infrastructure/i18n', () => ({
  i18nService: {
    t: (key: string) => key,
  },
}));

import {
  buildSessionMetadata,
  deriveLastFinishedAtFromMetadata,
  deriveSessionRelationshipFromMetadata,
  normalizeSessionRelationship,
  resolveSessionRelationship,
} from './sessionMetadata';

function createSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: 'session-1',
    title: 'Session Title',
    titleStatus: 'generated',
    dialogTurns: [],
    status: 'idle',
    config: {
      modelName: 'gpt-test',
      agentType: 'agentic',
    },
    createdAt: 1000,
    lastActiveAt: 1000,
    error: null,
    todos: [],
    maxContextTokens: 128128,
    mode: 'agentic',
    workspacePath: '/workspace',
    parentSessionId: undefined,
    sessionKind: 'normal',
    lastFinishedAt: undefined,
    btwThreads: [],
    btwOrigin: undefined,
    ...overrides,
  };
}

describe('sessionMetadata', () => {
  it('normalizes runtime sessions to an explicit normal kind', () => {
    expect(normalizeSessionRelationship({})).toEqual({
      sessionKind: 'normal',
      parentSessionId: undefined,
      btwOrigin: undefined,
    });
  });

  it('builds btw metadata without dropping existing fields', () => {
    const session = createSession({
      sessionId: 'child-1',
      title: 'BTW Child',
      sessionKind: 'btw',
      parentSessionId: 'parent-1',
      btwOrigin: {
        requestId: 'req-1',
        parentSessionId: 'parent-1',
        parentDialogTurnId: 'turn-9',
        parentTurnIndex: 9,
      },
      dialogTurns: [
        {
          id: 'turn-1',
          sessionId: 'child-1',
          userMessage: {
            id: 'user-1',
            content: 'question',
            timestamp: 1,
          },
          modelRounds: [
            {
              id: 'round-1',
              index: 0,
              items: [
                {
                  id: 'text-1',
                  type: 'text',
                  content: 'answer',
                  isStreaming: false,
                  timestamp: 2,
                  status: 'completed',
                },
              ],
              isStreaming: false,
              isComplete: true,
              status: 'completed',
              startTime: 1,
              endTime: 2,
            },
          ],
          status: 'completed',
          startTime: 1,
          endTime: 2,
        },
      ],
    });

    const existingMetadata: SessionMetadata = {
      sessionId: 'child-1',
      sessionName: 'Old Name',
      agentType: 'agentic',
      modelName: 'old-model',
      createdAt: 10,
      lastActiveAt: 10,
      turnCount: 99,
      messageCount: 99,
      toolCallCount: 99,
      status: 'active',
      snapshotSessionId: 'snapshot-1',
      tags: ['keep-me'],
      customMetadata: {
        unrelated: 'preserved',
      },
      todos: [],
      workspacePath: '/workspace',
    };

    const metadata = buildSessionMetadata(session, existingMetadata);

    expect(metadata.snapshotSessionId).toBe('snapshot-1');
    expect(metadata.tags).toEqual(['keep-me', 'btw']);
    expect(metadata.turnCount).toBe(99);
    expect(metadata.messageCount).toBe(99);
    expect(metadata.toolCallCount).toBe(99);
    expect(metadata.customMetadata).toEqual({
      unrelated: 'preserved',
      kind: 'btw',
      parentSessionId: 'parent-1',
      parentRequestId: 'req-1',
      parentDialogTurnId: 'turn-9',
      parentTurnIndex: 9,
      lastFinishedAt: null,
    });
  });

  it('writes normal metadata explicitly and removes stale btw linkage', () => {
    const session = createSession({
      sessionKind: 'normal',
      parentSessionId: undefined,
      btwOrigin: undefined,
    });

    const metadata = buildSessionMetadata(session, {
      sessionId: 'session-1',
      sessionName: 'Session Title',
      agentType: 'agentic',
      modelName: 'gpt-test',
      createdAt: 1000,
      lastActiveAt: 1000,
      turnCount: 0,
      messageCount: 0,
      toolCallCount: 0,
      status: 'active',
      tags: ['btw'],
      customMetadata: {
        unrelated: 'preserved',
        kind: 'btw',
        parentSessionId: 'stale-parent',
        parentRequestId: 'stale-request',
      },
      todos: [],
      workspacePath: '/workspace',
    });

    expect(metadata.customMetadata).toEqual({
      unrelated: 'preserved',
      kind: 'normal',
      lastFinishedAt: null,
    });
  });

  it('persists and restores lastFinishedAt without dropping unrelated metadata', () => {
    const session = createSession({
      lastFinishedAt: 4321,
    });

    const metadata = buildSessionMetadata(session, {
      sessionId: 'session-1',
      sessionName: 'Session Title',
      agentType: 'agentic',
      modelName: 'gpt-test',
      createdAt: 1000,
      lastActiveAt: 1000,
      turnCount: 0,
      messageCount: 0,
      toolCallCount: 0,
      status: 'active',
      tags: [],
      customMetadata: {
        unrelated: 'preserved',
      },
      todos: [],
      workspacePath: '/workspace',
    });

    expect(metadata.customMetadata).toEqual({
      unrelated: 'preserved',
      kind: 'normal',
      lastFinishedAt: 4321,
    });
    expect(deriveLastFinishedAtFromMetadata(metadata)).toBe(4321);
  });

  it('treats persisted btw identity as legacy and no longer restores it', () => {
    const metadata: SessionMetadata = {
      sessionId: 'child-1',
      sessionName: 'BTW Child',
      agentType: 'agentic',
      modelName: 'gpt-test',
      createdAt: 1000,
      lastActiveAt: 1001,
      turnCount: 1,
      messageCount: 2,
      toolCallCount: 0,
      status: 'active',
      tags: ['btw'],
      customMetadata: {
        kind: 'btw',
        parentSessionId: 'parent-1',
        parentRequestId: 'req-1',
        parentDialogTurnId: 'turn-2',
        parentTurnIndex: 2,
      },
      todos: [],
      workspacePath: '/workspace',
    };

    const relationship = deriveSessionRelationshipFromMetadata(metadata);
    const resolved = resolveSessionRelationship(relationship);

    expect(relationship).toEqual({
      sessionKind: 'normal',
      parentSessionId: undefined,
      btwOrigin: undefined,
    });
    expect(resolved).toEqual({
      kind: 'normal',
      isBtw: false,
      parentSessionId: undefined,
      displayAsChild: false,
      canOpenInAuxPane: false,
      origin: undefined,
    });
  });
});
