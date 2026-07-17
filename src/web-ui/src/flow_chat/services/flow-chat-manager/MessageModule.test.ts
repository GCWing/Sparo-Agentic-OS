import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowChatStore } from '../../store/FlowChatStore';
import { stateMachineManager } from '../../state-machine';
import { SessionExecutionEvent, SessionExecutionState } from '../../state-machine/types';
import type { FlowChatContext } from './types';
import { MODEL_CONFIGURATION_REQUIRED_CODE, sendMessage } from './MessageModule';
import { retryCreateBackendSession } from './SessionModule';
import {
  getAgenticOsSessionDescriptor,
  getDefaultSessionDescriptor,
  SESSION_DESCRIPTORS,
} from '../../domain/sessionDescriptor';
import { i18nService } from '@/infrastructure/i18n';

const agentApiMock = vi.hoisted(() => ({
  startDialogTurn: vi.fn(),
  updateSessionModel: vi.fn(),
}));
const configManagerMock = vi.hoisted(() => ({
  getSetting: vi.fn(),
}));
const notificationServiceMock = vi.hoisted(() => ({
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@/infrastructure/api/service-api/AgentAPI', () => ({
  agentAPI: agentApiMock,
}));

vi.mock('@/infrastructure/config/services/ConfigManager', () => ({
  configManager: configManagerMock,
}));

vi.mock('../../../shared/notification-system', () => ({
  notificationService: notificationServiceMock,
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
    notificationServiceMock.error.mockReset();
    notificationServiceMock.warning.mockReset();
    vi.mocked(retryCreateBackendSession).mockClear();
    configManagerMock.getSetting.mockImplementation(async (key: string) => {
      if (key === 'core.ai.agent_models') return {};
      if (key === 'core.ai.models') return [{ id: 'primary-model', enabled: true }];
      if (key === 'core.ai.default_models') return { primary: 'primary-model' };
      throw new Error(`Unexpected config key: ${key}`);
    });
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

  it('keeps the session usable and prompts for model setup when no model is configured', async () => {
    const store = FlowChatStore.getInstance();
    const sessionId = `zero-model-submit-${Date.now()}`;
    sessionIds.push(sessionId);
    store.createSession(sessionId, { workspacePath: 'D:/workspace/test' });
    configManagerMock.getSetting.mockImplementation(async (key: string) => {
      if (key === 'core.ai.agent_models') return {};
      if (key === 'core.ai.models') return [];
      if (key === 'core.ai.default_models') return {};
      throw new Error(`Unexpected config key: ${key}`);
    });

    const context = createTestContext(store);
    await expect(sendMessage(context, 'configure later', sessionId)).rejects.toMatchObject({
      code: MODEL_CONFIGURATION_REQUIRED_CODE,
    });

    expect(store.getState().sessions.get(sessionId)?.dialogTurns).toHaveLength(0);
    expect(agentApiMock.startDialogTurn).not.toHaveBeenCalled();
    expect(notificationServiceMock.error).not.toHaveBeenCalled();
    expect(notificationServiceMock.warning).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        duration: 0,
        actions: [expect.objectContaining({ variant: 'primary' })],
      }),
    );
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

  it('leaves model selection to the runtime for the settings profile', async () => {
    const store = FlowChatStore.getInstance();
    const sessionId = `settings-submit-${Date.now()}`;
    sessionIds.push(sessionId);

    store.createSession(
      sessionId,
      { storageScope: 'agentic_os', modelName: 'primary' },
      undefined,
      'Settings',
      undefined,
      SESSION_DESCRIPTORS.settings,
      undefined,
      'agentic_os',
    );
    agentApiMock.startDialogTurn.mockImplementation(async (request: any) => ({
      success: true,
      message: 'Dialog turn started',
      status: 'started',
      turnId: request.turnId,
    }));
    configManagerMock.getSetting.mockClear();

    const context = createTestContext(store);
    await sendMessage(context, 'use a larger interface font', sessionId);

    expect(agentApiMock.updateSessionModel).not.toHaveBeenCalled();
    expect(configManagerMock.getSetting).not.toHaveBeenCalled();
    expect(agentApiMock.startDialogTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        agentType: 'SettingsAgent',
      }),
    );
    expect(store.getState().sessions.get(sessionId)?.title).toBe('Settings');
  });

  it('localizes stable start errors for the settings profile', async () => {
    const store = FlowChatStore.getInstance();
    const sessionId = `settings-error-${Date.now()}`;
    sessionIds.push(sessionId);
    store.createSession(
      sessionId,
      { storageScope: 'agentic_os' },
      undefined,
      'Settings',
      undefined,
      SESSION_DESCRIPTORS.settings,
      undefined,
      'agentic_os',
    );
    agentApiMock.startDialogTurn.mockRejectedValueOnce(
      new Error('config.revision_conflict'),
    );

    const context = createTestContext(store);
    await expect(sendMessage(context, 'increase the font size', sessionId))
      .rejects.toThrow('config.revision_conflict');

    expect(notificationServiceMock.error).toHaveBeenCalledWith(
      i18nService.t('settings/ai-mode:session.sendErrors.revisionConflict'),
      {
        title: i18nService.t('settings/ai-mode:session.sendErrors.title'),
        duration: 5000,
      },
    );
    expect(notificationServiceMock.error).not.toHaveBeenCalledWith(
      'config.revision_conflict',
      expect.objectContaining({ title: 'Thinking process error' }),
    );
  });

  it('preserves the standard FlowChat error presentation for ordinary sessions', async () => {
    const store = FlowChatStore.getInstance();
    const sessionId = `ordinary-error-${Date.now()}`;
    sessionIds.push(sessionId);
    store.createSession(sessionId, { workspacePath: 'D:/workspace/test' });
    agentApiMock.startDialogTurn.mockRejectedValueOnce(new Error('ordinary provider failure'));

    const context = createTestContext(store);
    await expect(sendMessage(context, 'hello', sessionId))
      .rejects.toThrow('ordinary provider failure');

    expect(notificationServiceMock.error).toHaveBeenCalledWith(
      'ordinary provider failure',
      {
        title: 'Thinking process error',
        duration: 5000,
      },
    );
  });

  it('does not recreate the session when the requested Agent is not registered', async () => {
    const store = FlowChatStore.getInstance();
    const sessionId = `agent-not-found-${Date.now()}`;
    sessionIds.push(sessionId);
    store.createSession(sessionId, { workspacePath: 'D:/workspace/test' });
    agentApiMock.startDialogTurn.mockRejectedValue(
      new Error('Failed to start dialog turn: Not found: Agent not found: missing-agent'),
    );

    const context = createTestContext(store);
    await expect(sendMessage(context, 'hello', sessionId))
      .rejects.toThrow('Agent not found: missing-agent');

    expect(retryCreateBackendSession).not.toHaveBeenCalled();
    expect(agentApiMock.startDialogTurn).toHaveBeenCalledTimes(1);
  });

  it('recreates and retries only when the backend session is missing', async () => {
    const store = FlowChatStore.getInstance();
    const sessionId = `session-not-found-${Date.now()}`;
    sessionIds.push(sessionId);
    store.createSession(sessionId, { workspacePath: 'D:/workspace/test' });
    agentApiMock.startDialogTurn
      .mockRejectedValueOnce(new Error(`Not found: Session not found: ${sessionId}`))
      .mockImplementationOnce(async (request: any) => ({
        success: true,
        message: 'Dialog turn started',
        status: 'started',
        turnId: request.turnId,
      }));

    const context = createTestContext(store);
    await sendMessage(context, 'hello', sessionId);

    expect(retryCreateBackendSession).toHaveBeenCalledOnce();
    expect(agentApiMock.startDialogTurn).toHaveBeenCalledTimes(2);
  });
});
