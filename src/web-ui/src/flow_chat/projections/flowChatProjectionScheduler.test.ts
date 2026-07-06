import { afterEach, describe, expect, it } from 'vitest';
import { COLLAPSIBLE_TOOL_NAMES } from '../tool-cards/collapsibleTools';
import type { FlowToolItem, ModelRound, Session } from '../types/flow-chat';
import { sessionToVirtualItems } from './flowChatProjectionScheduler';

const dynamicToolName = 'DynamicExploreTool';

function toolItem(id: string, toolName: string): FlowToolItem {
  return {
    id,
    type: 'tool',
    toolName,
    timestamp: 1,
    status: 'completed',
    toolCall: {
      id,
      input: {},
    },
  };
}

function modelRound(id: string, items: FlowToolItem[]): ModelRound {
  return {
    id,
    index: 0,
    items,
    isStreaming: false,
    isComplete: true,
    status: 'completed',
    startTime: 1,
    endTime: 2,
  };
}

function sessionWithRounds(rounds: ModelRound[]): Session {
  return {
    sessionId: `session-${Math.random()}`,
    dialogTurns: [
      {
        id: 'turn-1',
        sessionId: 'session-1',
        userMessage: {
          id: 'user-1',
          content: 'explore',
          timestamp: 1,
        },
        modelRounds: rounds,
        status: 'completed',
        startTime: 1,
        endTime: 2,
      },
    ],
    status: 'idle',
    config: {},
    createdAt: 1,
    lastActiveAt: 1,
    error: null,
    descriptor: {
      kind: 'project',
      scope: 'workspace',
      agentType: 'bitfun-coder',
      title: 'Test',
    },
    sessionKind: 'user_dialog',
  } as unknown as Session;
}

describe('flowChatProjectionScheduler explore group stats', () => {
  afterEach(() => {
    COLLAPSIBLE_TOOL_NAMES.delete(dynamicToolName);
  });

  it('counts specific explore tools and keeps a fallback bucket for uncategorized started tools', () => {
    COLLAPSIBLE_TOOL_NAMES.add(dynamicToolName);

    const virtualItems = sessionToVirtualItems(sessionWithRounds([
      modelRound('round-1', [
        toolItem('read-1', 'Read'),
        toolItem('fetch-1', 'WebFetch'),
      ]),
      modelRound('round-2', [
        toolItem('search-1', 'WebSearch'),
        toolItem('command-1', 'Bash'),
        toolItem('dynamic-1', dynamicToolName),
      ]),
    ]));

    const exploreGroup = virtualItems.find(item => item.type === 'explore-group');

    expect(exploreGroup?.data.stats).toMatchObject({
      readCount: 1,
      searchCount: 1,
      fetchCount: 1,
      commandCount: 1,
      otherCount: 1,
      totalToolCount: 5,
    });
    expect(exploreGroup?.data.stats.toolCounts.map(({ category, count }) => ({ category, count }))).toEqual([
      { category: 'read', count: 1 },
      { category: 'search', count: 1 },
      { category: 'fetch', count: 1 },
      { category: 'command', count: 1 },
      { category: 'other', count: 1 },
    ]);
  });
});
