import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowChatStore } from '../../store/FlowChatStore';
import {
  getDefaultSessionDescriptor,
  getProductAppRuntimeSessionDescriptor,
} from '../../domain/sessionDescriptor';
import type { FlowChatContext } from './types';
import {
  createChatSession,
  ensureBackendSession,
  retryCreateBackendSession,
  retargetEmptyChatSessionWorkspace,
} from './SessionModule';

const agentApiMock = vi.hoisted(() => ({
  createSession: vi.fn(),
  ensureCoordinatorSession: vi.fn(),
  updateSessionWorkspace: vi.fn(),
}));

const sessionApiMock = vi.hoisted(() => ({
  deleteSession: vi.fn(),
  loadSessionMetadata: vi.fn(),
  saveSessionMetadata: vi.fn(),
}));

const openSessionMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@/infrastructure/api/service-api/AgentAPI', () => ({
  agentAPI: agentApiMock,
}));

vi.mock('@/infrastructure/api/service-api/SessionAPI', () => ({
  sessionAPI: sessionApiMock,
}));

vi.mock('@/infrastructure/config/services/ConfigManager', () => ({
  configManager: {
    getConfig: vi.fn(async (key: string) => {
      if (key === 'ai.models') return [];
      return {};
    }),
  },
}));

vi.mock('@/infrastructure/services/business/workspaceManager', () => ({
  workspaceManager: {
    getState: vi.fn(() => ({
      openedWorkspaces: new Map(),
    })),
  },
}));

vi.mock('@/app/navigation/navigationController', () => ({
  openSession: openSessionMock,
}));

function createTestContext(store: FlowChatStore): FlowChatContext {
  return {
    flowChatStore: store,
    processingManager: {
      clearSessionStatus: vi.fn(),
      registerStatus: vi.fn(),
      getSessionStatuses: vi.fn(() => []),
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

describe('createChatSession workspace scope', () => {
  const sessionIds: string[] = [];

  beforeEach(() => {
    agentApiMock.createSession.mockReset();
    agentApiMock.ensureCoordinatorSession.mockReset();
    agentApiMock.updateSessionWorkspace.mockReset();
    sessionApiMock.deleteSession.mockReset();
    sessionApiMock.loadSessionMetadata.mockReset();
    sessionApiMock.saveSessionMetadata.mockReset();
    openSessionMock.mockReset();
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal('CustomEvent', class {
      public readonly type: string;
      public readonly detail: unknown;

      constructor(type: string, init?: CustomEventInit) {
        this.type = type;
        this.detail = init?.detail;
      }
    });
  });

  afterEach(() => {
    const store = FlowChatStore.getInstance();
    sessionIds.splice(0).forEach(sessionId => store.removeSession(sessionId));
    vi.unstubAllGlobals();
  });

  it('keeps an explicit workspace path for agentic_os Product App runtime sessions', async () => {
    const store = FlowChatStore.getInstance();
    const context = createTestContext(store);
    const sessionId = `harmony-runtime-${Date.now()}`;
    const workspacePath = 'D:/workspace/sparo_harmony';
    sessionIds.push(sessionId);

    agentApiMock.createSession.mockResolvedValue({
      sessionId,
      sessionName: 'HarmonyOS Dev',
      agentType: 'harmonyos-dev-agent',
    });

    await createChatSession(
      context,
      {
        storageScope: 'agentic_os',
        workspacePath,
        sessionName: 'HarmonyOS Dev',
      },
      getProductAppRuntimeSessionDescriptor('harmonyos-dev-agent'),
    );

    expect(agentApiMock.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath,
        storageScope: 'agentic_os',
      }),
    );
    expect(store.getState().sessions.get(sessionId)?.workspacePath).toBe(workspacePath);
  });

  it('honors a caller-reserved session id for an optimistic shell', async () => {
    const store = FlowChatStore.getInstance();
    const context = createTestContext(store);
    const sessionId = `optimistic-session-${Date.now()}`;
    sessionIds.push(sessionId);
    agentApiMock.createSession.mockResolvedValue({
      sessionId,
      sessionName: 'Optimistic Product App',
      agentType: 'product-app-agent',
    });

    await createChatSession(
      context,
      {
        storageScope: 'agentic_os',
        sessionName: 'Optimistic Product App',
        navigate: false,
      },
      getProductAppRuntimeSessionDescriptor('product-app-agent'),
      { sessionId },
    );

    expect(agentApiMock.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId }),
    );
    expect(store.getState().sessions.has(sessionId)).toBe(true);
  });

  it('retargets the current empty workspace session without opening target workspace history', async () => {
    const store = FlowChatStore.getInstance();
    const context = createTestContext(store);
    const sessionId = `draft-session-${Date.now()}`;
    const oldWorkspace = { id: 'old-workspace', rootPath: 'D:/workspace/old' };
    const newWorkspace = { id: 'new-workspace', rootPath: 'D:/workspace/new' };
    const descriptor = getDefaultSessionDescriptor();
    sessionIds.push(sessionId);

    store.createSession(
      sessionId,
      {
        workspacePath: oldWorkspace.rootPath,
        workspaceId: oldWorkspace.id,
        storageScope: 'workspace',
      },
      undefined,
      'Draft',
      128128,
      descriptor,
      oldWorkspace.rootPath,
      'workspace',
    );

    agentApiMock.updateSessionWorkspace.mockResolvedValue(undefined);
    agentApiMock.ensureCoordinatorSession.mockResolvedValue(undefined);
    sessionApiMock.loadSessionMetadata.mockResolvedValue(null);

    await retargetEmptyChatSessionWorkspace(
      context,
      sessionId,
      newWorkspace,
      descriptor,
    );

    const session = store.getState().sessions.get(sessionId);
    expect(session?.sessionId).toBe(sessionId);
    expect(session?.workspacePath).toBe(newWorkspace.rootPath);
    expect(session?.workspaceId).toBe(newWorkspace.id);
    expect(session?.config.workspacePath).toBe(newWorkspace.rootPath);
    expect(session?.config.workspaceId).toBe(newWorkspace.id);
    expect(agentApiMock.updateSessionWorkspace).toHaveBeenCalledWith({
      sessionId,
      workspacePath: newWorkspace.rootPath,
    });
    expect(agentApiMock.createSession).not.toHaveBeenCalled();
    expect(sessionApiMock.deleteSession).toHaveBeenCalledWith(
      sessionId,
      oldWorkspace.rootPath,
      'workspace',
    );
    expect(openSessionMock).toHaveBeenCalledWith(sessionId);
  });

  it('shares one backend readiness request across concurrent user actions', async () => {
    const store = FlowChatStore.getInstance();
    const context = createTestContext(store);
    const sessionId = `readiness-session-${Date.now()}`;
    sessionIds.push(sessionId);
    store.createSession(
      sessionId,
      { workspacePath: 'D:/workspace/current', storageScope: 'workspace' },
      undefined,
      'Readiness',
      128128,
      getDefaultSessionDescriptor(),
      'D:/workspace/current',
      'workspace',
    );

    let release!: () => void;
    agentApiMock.ensureCoordinatorSession.mockImplementationOnce(() => (
      new Promise<void>((resolve) => { release = resolve; })
    ));
    const finishRuntimeWorkspaceSync = vi.fn(async () => {});

    const first = ensureBackendSession(context, sessionId, finishRuntimeWorkspaceSync);
    const second = ensureBackendSession(context, sessionId);
    expect(agentApiMock.ensureCoordinatorSession).toHaveBeenCalledTimes(1);

    release();
    await Promise.all([first, second]);
    expect(finishRuntimeWorkspaceSync).toHaveBeenCalledTimes(1);
  });

  it('waits for store-level transcript hydration before coordinator restore', async () => {
    const store = FlowChatStore.getInstance();
    const context = createTestContext(store);
    const sessionId = `history-priority-${Date.now()}`;
    sessionIds.push(sessionId);
    store.createSession(
      sessionId,
      { workspacePath: 'D:/workspace/current', storageScope: 'workspace' },
      undefined,
      'History priority',
      128128,
      getDefaultSessionDescriptor(),
      'D:/workspace/current',
      'workspace',
    );
    let releaseHistory!: () => void;
    const historyLoad = new Promise<void>((resolve) => { releaseHistory = resolve; });
    const pendingHistorySpy = vi
      .spyOn(store, 'getPendingSessionHistoryLoad')
      .mockReturnValue(historyLoad);
    agentApiMock.ensureCoordinatorSession.mockResolvedValue(undefined);

    const readiness = ensureBackendSession(context, sessionId);
    await Promise.resolve();
    expect(agentApiMock.ensureCoordinatorSession).not.toHaveBeenCalled();

    releaseHistory();
    await readiness;
    expect(agentApiMock.ensureCoordinatorSession).toHaveBeenCalledTimes(1);
    pendingHistorySpy.mockRestore();
  });

  it('does not drop runtime workspace sync when it joins an existing readiness request', async () => {
    const store = FlowChatStore.getInstance();
    const context = createTestContext(store);
    const sessionId = `readiness-reverse-${Date.now()}`;
    sessionIds.push(sessionId);
    store.createSession(
      sessionId,
      { workspacePath: 'D:/workspace/current', storageScope: 'workspace' },
      undefined,
      'Readiness reverse',
      128128,
      getDefaultSessionDescriptor(),
      'D:/workspace/current',
      'workspace',
    );
    let release!: () => void;
    agentApiMock.ensureCoordinatorSession.mockImplementationOnce(() => (
      new Promise<void>((resolve) => { release = resolve; })
    ));
    let releaseWorkspaceSync!: () => void;
    const finishRuntimeWorkspaceSync = vi.fn(() => (
      new Promise<void>((resolve) => { releaseWorkspaceSync = resolve; })
    ));

    const userAction = ensureBackendSession(context, sessionId);
    const hostSync = ensureBackendSession(context, sessionId, finishRuntimeWorkspaceSync);
    let userActionSettled = false;
    void userAction.then(() => { userActionSettled = true; });
    release();
    await vi.waitFor(() => expect(finishRuntimeWorkspaceSync).toHaveBeenCalledTimes(1));
    expect(userActionSettled).toBe(false);

    const thirdAction = ensureBackendSession(context, sessionId);
    let thirdActionSettled = false;
    void thirdAction.then(() => { thirdActionSettled = true; });
    await Promise.resolve();
    expect(thirdActionSettled).toBe(false);

    releaseWorkspaceSync();
    await Promise.all([userAction, hostSync, thirdAction]);

    expect(agentApiMock.ensureCoordinatorSession).toHaveBeenCalledTimes(1);
    expect(finishRuntimeWorkspaceSync).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent backend session recreation attempts', async () => {
    const store = FlowChatStore.getInstance();
    const context = createTestContext(store);
    const sessionId = `retry-create-${Date.now()}`;
    sessionIds.push(sessionId);
    store.createSession(
      sessionId,
      { workspacePath: 'D:/workspace/current', storageScope: 'workspace' },
      undefined,
      'Retry create',
      128128,
      getDefaultSessionDescriptor(),
      'D:/workspace/current',
      'workspace',
    );
    let release!: () => void;
    agentApiMock.createSession.mockImplementationOnce(() => (
      new Promise<void>((resolve) => { release = resolve; })
    ));

    const first = retryCreateBackendSession(context, sessionId);
    const second = retryCreateBackendSession(context, sessionId);
    const concurrentReadiness = ensureBackendSession(context, sessionId);
    expect(agentApiMock.createSession).toHaveBeenCalledTimes(1);
    expect(agentApiMock.ensureCoordinatorSession).not.toHaveBeenCalled();

    release();
    await Promise.all([first, second, concurrentReadiness]);
  });
});
