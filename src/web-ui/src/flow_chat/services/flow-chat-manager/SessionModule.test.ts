import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowChatStore } from '../../store/FlowChatStore';
import {
  getDefaultSessionDescriptor,
  getProductAppRuntimeSessionDescriptor,
} from '../../domain/sessionDescriptor';
import type { FlowChatContext } from './types';
import { createChatSession, retargetEmptyChatSessionWorkspace } from './SessionModule';

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
});
