import { afterEach, describe, expect, it } from 'vitest';
import { FlowChatStore } from '../../store/FlowChatStore';
import type { DialogTurn, FlowToolItem, Session } from '../../types/flow-chat';
import type { FlowChatContext } from './types';
import {
  handleToolExecutionProgress,
  handleToolTerminalReady,
  processToolEvent,
} from './ToolEventModule';

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

  it('updates bulk-hydrated tool progress through the tool id index', () => {
    const store = FlowChatStore.getInstance();
    const sessionId = `tool-index-bulk-session-${Date.now()}`;
    const turnId = `turn-${Date.now()}`;
    sessionIds.push(sessionId);

    const session = createSessionWithTool(sessionId, turnId, {
      id: 'bulk-tool-1',
      type: 'tool',
      toolName: 'Bash',
      toolCall: { id: 'bulk-tool-1', input: { command: 'npm test' } },
      timestamp: 1,
      status: 'running',
      startTime: 1,
    });

    store.setState(previous => {
      const sessions = new Map(previous.sessions);
      sessions.set(sessionId, session);
      return {
        ...previous,
        sessions,
      };
    });

    handleToolExecutionProgress({
      tool_use_id: 'bulk-tool-1',
      progress_message: 'running tests',
      percentage: 42,
    });

    const tool = store.findToolItem(sessionId, turnId, 'bulk-tool-1') as FlowToolItem;
    expect((tool as any)._progressMessage).toBe('running tests');
    expect((tool as any)._progressPercentage).toBe(42);
    expect((tool as any)._progressLogs).toEqual(['running tests']);
  });

  it('applies terminal-ready events through the tool id index', () => {
    const store = FlowChatStore.getInstance();
    const sessionId = `tool-index-terminal-session-${Date.now()}`;
    const turnId = `turn-${Date.now()}`;
    sessionIds.push(sessionId);

    const session = createSessionWithTool(sessionId, turnId, {
      id: 'terminal-tool-1',
      type: 'tool',
      toolName: 'Bash',
      toolCall: { id: 'terminal-tool-1', input: { command: 'pnpm test' } },
      timestamp: 1,
      status: 'running',
      startTime: 1,
    });

    store.setState(previous => {
      const sessions = new Map(previous.sessions);
      sessions.set(sessionId, session);
      return {
        ...previous,
        sessions,
      };
    });

    handleToolTerminalReady({
      tool_use_id: 'terminal-tool-1',
      terminal_session_id: 'terminal-session-1',
    });

    const tool = store.findToolItem(sessionId, turnId, 'terminal-tool-1') as FlowToolItem;
    expect(tool.terminalSessionId).toBe('terminal-session-1');
  });
});

function createSessionWithTool(
  sessionId: string,
  turnId: string,
  tool: FlowToolItem,
): Session {
  return {
    sessionId,
    title: 'Tool index test',
    titleStatus: 'generated',
    dialogTurns: [
      {
        id: turnId,
        sessionId,
        userMessage: { id: 'user-1', content: 'run', timestamp: 1 },
        modelRounds: [
          {
            id: 'round-1',
            index: 0,
            items: [tool],
            isStreaming: true,
            isComplete: false,
            status: 'streaming',
            startTime: 1,
          },
        ],
        status: 'running',
        startTime: 1,
      },
    ],
    status: 'processing',
    config: {},
    createdAt: 1,
    lastActiveAt: 1,
    error: null,
    maxContextTokens: 128128,
    mode: 'agentic',
    workspaceId: 'test-workspace',
    storageScope: 'workspace',
    isTransient: true,
  };
}
