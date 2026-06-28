import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowChatStore } from '../../store/FlowChatStore';
import { getSurfaceComponentWorkbenchSessionDescriptor } from '../../domain/sessionDescriptor';
import type { FlowChatContext } from './types';
import { createChatSession } from './SessionModule';

const agentApiMock = vi.hoisted(() => ({
  createSession: vi.fn(),
}));

const openSurfaceMock = vi.hoisted(() => vi.fn());

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

vi.mock('@/infrastructure/services/business/workspaceManager', () => ({
  workspaceManager: {
    getState: vi.fn(() => ({
      openedWorkspaces: new Map(),
    })),
  },
}));

vi.mock('@/app/navigation/workspaceSurfaceStore', () => ({
  useWorkspaceSurfaceStore: {
    getState: vi.fn(() => ({
      openSurface: openSurfaceMock,
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

describe('createChatSession workspace scope', () => {
  const sessionIds: string[] = [];

  beforeEach(() => {
    agentApiMock.createSession.mockReset();
    openSurfaceMock.mockReset();
  });

  afterEach(() => {
    const store = FlowChatStore.getInstance();
    sessionIds.splice(0).forEach(sessionId => store.removeSession(sessionId));
  });

  it('keeps an explicit workspace path for agentic_os Product App workbench sessions', async () => {
    const store = FlowChatStore.getInstance();
    const context = createTestContext(store);
    const sessionId = `harmony-workbench-${Date.now()}`;
    const workspacePath = 'D:/workspace/bitfun_harmony';
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
      getSurfaceComponentWorkbenchSessionDescriptor('harmonyos-dev-agent'),
    );

    expect(agentApiMock.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath,
        storageScope: 'agentic_os',
      }),
    );
    expect(store.getState().sessions.get(sessionId)?.workspacePath).toBe(workspacePath);
  });
});
