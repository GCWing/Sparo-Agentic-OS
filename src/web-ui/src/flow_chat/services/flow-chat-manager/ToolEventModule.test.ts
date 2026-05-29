import { afterEach, describe, expect, it } from 'vitest';
import { FlowChatStore } from '../../store/FlowChatStore';
import type { DialogTurn, FlowToolItem } from '../../types/flow-chat';
import type { FlowChatContext } from './types';
import { processToolEvent } from './ToolEventModule';

function createTestContext(store: FlowChatStore): FlowChatContext {
  return {
    flowChatStore: store,
    processingManager: {} as FlowChatContext['processingManager'],
    eventBatcher: {
      getBufferSize: () => 0,
      flushNow: () => {},
    } as FlowChatContext['eventBatcher'],
    toolParamBuffers: new Map(),
    toolParamParseTimestamps: new Map(),
    pendingTurnCompletions: new Map(),
    pendingHistoryLoads: new Map(),
    contentBuffers: new Map(),
    activeTextItems: new Map(),
    saveDebouncers: new Map(),
    lastSaveTimestamps: new Map(),
    lastSaveHashes: new Map(),
    turnSaveInFlight: new Map(),
    turnSavePending: new Set(),
    workspaceContextPath: null,
  };
}

describe('processToolEvent', () => {
  const sessionIds: string[] = [];

  afterEach(() => {
    const store = FlowChatStore.getInstance();
    sessionIds.splice(0).forEach(sessionId => store.removeSession(sessionId));
  });

  it('drops late tool events once the tool owner is terminal', () => {
    const store = FlowChatStore.getInstance();
    const sessionId = `tool-terminal-session-${Date.now()}`;
    const turnId = `turn-${Date.now()}`;
    sessionIds.push(sessionId);

    const completedTool: FlowToolItem = {
      id: 'tool-1',
      type: 'tool',
      toolName: 'Shell',
      toolCall: { id: 'tool-1', input: { command: 'echo done' } },
      toolResult: { result: { output: 'done' }, success: true },
      runtime: {
        lifecycle: 'completed',
        inputPhase: 'parsed',
        confirmation: 'none',
        input: { command: 'echo done' },
        result: { output: 'done' },
      },
      timestamp: 1,
      status: 'completed',
      startTime: 1,
      endTime: 2,
    };

    const turn: DialogTurn = {
      id: turnId,
      sessionId,
      userMessage: { id: 'user-1', content: 'run', timestamp: 1 },
      modelRounds: [
        {
          id: 'round-1',
          index: 0,
          items: [completedTool],
          isStreaming: false,
          isComplete: false,
          status: 'streaming',
          startTime: 1,
        },
      ],
      status: 'running',
      startTime: 1,
    };

    store.createSession(sessionId, {});
    store.addDialogTurn(sessionId, turn);

    processToolEvent(
      createTestContext(store),
      sessionId,
      turnId,
      {
        event_type: 'Cancelled',
        tool_id: 'tool-1',
        tool_name: 'Shell',
        reason: 'late cancel',
      },
    );

    const tool = store.findToolItem(sessionId, turnId, 'tool-1') as FlowToolItem;
    expect(tool.status).toBe('completed');
    expect(tool.runtime?.lifecycle).toBe('completed');
    expect(tool.toolResult?.success).toBe(true);
  });
});
