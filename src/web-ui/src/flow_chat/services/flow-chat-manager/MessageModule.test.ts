import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowChatStore } from '../../store/FlowChatStore';
import { stateMachineManager } from '../../state-machine';
import { SessionExecutionEvent, SessionExecutionState } from '../../state-machine/types';
import type { FlowChatContext } from './types';
import { sendMessage } from './MessageModule';
import {
  getAgenticOsSessionDescriptor,
  getDefaultSessionDescriptor,
  SESSION_DESCRIPTORS,
} from '../../domain/sessionDescriptor';

const agentApiMock = vi.hoisted(() => ({
  startDialogTurn: vi.fn(),
  updateSessionModel: vi.fn(),
}));

vi.mock('@/infrastructure/api/service-api/AgentAPI', () => ({
  agentAPI: agentApiMock,
}));

vi.mock('@/infrastructure/config/services/ConfigManager', () => ({
  configManager: {
    getConfig: vi.fn(async (key: string) => {
      if (key === 'ai.models') return [];
      return {};
    }),
  },
}));

vi.mock('./SessionModule', async () => {
  const actual = await vi.importActual<typeof import('./SessionModule')>('./SessionModule');
  return {
    ...actual,
    ensureBackendSession: vi.fn(async () => {}),
    retryCreateBackendSession: vi.fn(async () => {}),
  };
});

vi.mock('../../store/sessionTurnQueueStore', () => ({
  useSessionTurnQueueStore: {
    getState: vi.fn(() => ({
      refreshQueue: vi.fn(),
    })),
  },
}));

function createTestContext(store: FlowChatStore): FlowChatContext {
  return {
    flowChatStore: store,
    processingManager: {
      clearSessionStatus: vi.fn(),
      registerStatus: vi.fn(),
    } as unknown as FlowChatContext['processingManager'],
    eventBatcher: {
      getBufferSize: () => 0,
      clear: vi.fn(),
    } as unknown as FlowChatContext['eventBatcher'],
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

describe('sendMessage scheduler projection', () => {
  const sessionIds: string[] = [];

  beforeEach(() => {
    agentApiMock.startDialogTurn.mockReset();
    agentApiMock.updateSessionModel.mockReset();
  });

  afterEach(() => {
    const store = FlowChatStore.getInstance();
    sessionIds.splice(0).forEach(sessionId => {
      store.removeSession(sessionId);
      stateMachineManager.delete(sessionId);
    });
  });

  it('keeps the current turn processing and removes the pre-created turn when submission is queued', async () => {
    const store = FlowChatStore.getInstance();
    const sessionId = `queued-submit-${Date.now()}`;
    const runningTurnId = 'running-turn';
    sessionIds.push(sessionId);

    store.createSession(sessionId, { workspacePath: 'D:/workspace/test' });
    await stateMachineManager.transition(sessionId, SessionExecutionEvent.START, {
      taskId: sessionId,
      dialogTurnId: runningTurnId,
    });

    agentApiMock.startDialogTurn.mockImplementation(async (request: any) => ({
      success: true,
      message: 'Dialog turn queued',
      status: 'queued',
      turnId: request.turnId,
    }));

    const context = createTestContext(store);
    await sendMessage(context, 'next message', sessionId);

    const snapshot = stateMachineManager.getSnapshot(sessionId);
    expect(snapshot?.currentState).toBe(SessionExecutionState.PROCESSING);
    expect(snapshot?.context.currentDialogTurnId).toBe(runningTurnId);

    const session = store.getState().sessions.get(sessionId);
    expect(session?.dialogTurns).toHaveLength(0);
    expect(context.processingManager.registerStatus).not.toHaveBeenCalled();
  });

  it('starts the frontend execution projection when the scheduler starts immediately', async () => {
    const store = FlowChatStore.getInstance();
    const sessionId = `started-submit-${Date.now()}`;
    sessionIds.push(sessionId);

    store.createSession(sessionId, { workspacePath: 'D:/workspace/test' });
    agentApiMock.startDialogTurn.mockImplementation(async (request: any) => ({
      success: true,
      message: 'Dialog turn started',
      status: 'started',
      turnId: request.turnId,
    }));

    const context = createTestContext(store);
    await sendMessage(context, 'start now', sessionId);

    const session = store.getState().sessions.get(sessionId);
    const turnId = session?.dialogTurns[0]?.id;
    const snapshot = stateMachineManager.getSnapshot(sessionId);

    expect(snapshot?.currentState).toBe(SessionExecutionState.PROCESSING);
    expect(snapshot?.context.currentDialogTurnId).toBe(turnId);
    expect(context.processingManager.registerStatus).toHaveBeenCalledOnce();
  });

  it('ignores a stale BitFun Coder override for an OSAgent session', async () => {
    const store = FlowChatStore.getInstance();
    const sessionId = `osagent-submit-${Date.now()}`;
    sessionIds.push(sessionId);

    store.createSession(
      sessionId,
      { storageScope: 'agentic_os' },
      undefined,
      'Agentic OS',
      undefined,
      getAgenticOsSessionDescriptor(),
      undefined,
      'agentic_os',
    );
    agentApiMock.startDialogTurn.mockImplementation(async (request: any) => ({
      success: true,
      message: 'Dialog turn started',
      status: 'started',
      turnId: request.turnId,
    }));

    const context = createTestContext(store);
    await sendMessage(context, 'analyze architecture', sessionId, undefined, 'bitfun-coder');

    expect(agentApiMock.startDialogTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        agentType: 'OSAgent',
      }),
    );
  });

  it('keeps allowed BitFun Coder session agent overrides', async () => {
    const store = FlowChatStore.getInstance();
    const sessionId = `plan-submit-${Date.now()}`;
    sessionIds.push(sessionId);

    store.createSession(
      sessionId,
      { workspacePath: 'D:/workspace/test' },
      undefined,
      'Plan task',
      undefined,
      SESSION_DESCRIPTORS.bitfunCoder,
      'D:/workspace/test',
      'workspace',
    );
    agentApiMock.startDialogTurn.mockImplementation(async (request: any) => ({
      success: true,
      message: 'Dialog turn started',
      status: 'started',
      turnId: request.turnId,
    }));

    const context = createTestContext(store);
    await sendMessage(context, 'make a plan', sessionId, undefined, 'bitfun-plan');

    expect(agentApiMock.startDialogTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        agentType: 'bitfun-plan',
      }),
    );
  });
});
