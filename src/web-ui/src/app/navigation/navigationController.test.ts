import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginNavigationIntent,
  commitPendingSessionNavigation,
  goBackScene,
  openHome,
  openScene,
  openSession,
} from './navigationController';
import { useWorkspaceSurfaceStore } from './workspaceSurfaceStore';
import { createAgenticOsHomeSurface } from './workspaceSurfaceTypes';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import type { SessionMetadata } from '@/shared/types/session-history';

const sessionApiMock = vi.hoisted(() => ({
  listSessions: vi.fn(),
  loadSessionMetadata: vi.fn(),
}));

const createSessionMock = vi.hoisted(() => vi.fn());
const activateSessionDataMock = vi.hoisted(() => vi.fn(async () => {}));
const syncSessionToModernStoreMock = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/api/service-api/SessionAPI', () => ({
  sessionAPI: sessionApiMock,
}));

vi.mock('@/infrastructure/config/services/ConfigManager', () => ({
  configManager: {
    getSetting: vi.fn(async () => ({})),
  },
}));

vi.mock('@/infrastructure/services/business/workspaceManager', () => ({
  workspaceManager: {
    getState: vi.fn(() => ({ openedWorkspaces: new Map() })),
  },
}));

vi.mock('@/flow_chat/services/FlowChatManager', () => ({
  flowChatManager: {
    createChatSession: createSessionMock,
    activateSessionData: activateSessionDataMock,
  },
}));

vi.mock('@/flow_chat/services/storeSync', () => ({
  syncSessionToModernStore: syncSessionToModernStoreMock,
}));

function agenticOsMetadata(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    sessionId: 'os-empty-1',
    sessionName: 'Agentic OS',
    agentType: 'OSAgent',
    modelName: 'primary',
    createdAt: 1_000,
    lastActiveAt: 1_000,
    turnCount: 0,
    messageCount: 0,
    toolCallCount: 0,
    status: 'active',
    tags: [],
    workspacePath: 'C:/Users/HUAWEI/AppData/Roaming/sparo_os/agentic_os',
    storageScope: 'agentic_os',
    ...overrides,
  };
}

function resetStores(): void {
  for (const sessionId of Array.from(flowChatStore.getState().sessions.keys())) {
    flowChatStore.removeSession(sessionId);
  }
  useWorkspaceSurfaceStore.setState({
    activeSurface: createAgenticOsHomeSurface(),
    previousSurface: null,
    currentOsSessionId: null,
    sceneHistory: [],
    surfaceContext: null,
  });
}

describe('navigationController openHome', () => {
  beforeEach(() => {
    sessionApiMock.listSessions.mockReset();
    sessionApiMock.loadSessionMetadata.mockReset();
    createSessionMock.mockReset();
    activateSessionDataMock.mockClear();
    syncSessionToModernStoreMock.mockClear();
    createSessionMock.mockResolvedValue('os-new-1');
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
    resetStores();
  });

  afterEach(() => {
    resetStores();
    vi.unstubAllGlobals();
  });

  it('reuses a persisted empty Agentic OS session before creating a new one', async () => {
    sessionApiMock.listSessions.mockResolvedValue([
      agenticOsMetadata(),
    ]);

    const sessionId = await openHome();

    expect(sessionId).toBe('os-empty-1');
    expect(sessionApiMock.listSessions).toHaveBeenCalledWith(undefined, 'agentic_os');
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(useWorkspaceSurfaceStore.getState().currentOsSessionId).toBe('os-empty-1');
    expect(flowChatStore.getState().sessions.get('os-empty-1')?.dialogTurns).toEqual([]);
    expect(activateSessionDataMock).toHaveBeenCalledWith('os-empty-1');
  });

  it('creates a new Agentic OS session when the latest persisted OS session has turns', async () => {
    sessionApiMock.listSessions.mockResolvedValue([
      agenticOsMetadata({
        sessionId: 'os-empty-old',
        createdAt: 1_000,
        lastActiveAt: 1_000,
      }),
      agenticOsMetadata({
        sessionId: 'os-with-history',
        createdAt: 2_000,
        lastActiveAt: 2_000,
        turnCount: 1,
        messageCount: 2,
      }),
    ]);

    const sessionId = await openHome();

    expect(sessionId).toBe('os-new-1');
    expect(createSessionMock).toHaveBeenCalledWith(
      { storageScope: 'agentic_os', navigate: false },
      expect.objectContaining({
        hostKind: 'system-agentic-os',
        identityId: 'agentic-os',
      }),
    );
    expect(useWorkspaceSurfaceStore.getState().currentOsSessionId).toBe('os-new-1');
  });

  it('does not treat other agentic_os scoped sessions as the Agentic OS home session', async () => {
    sessionApiMock.listSessions.mockResolvedValue([
      agenticOsMetadata({
        sessionId: 'app-builder-empty-1',
        sessionName: 'App Builder',
        agentType: 'AppBuilder',
      }),
    ]);

    const sessionId = await openHome();

    expect(sessionId).toBe('os-new-1');
    expect(createSessionMock).toHaveBeenCalledWith(
      { storageScope: 'agentic_os', navigate: false },
      expect.objectContaining({
        hostKind: 'system-agentic-os',
        identityId: 'agentic-os',
      }),
    );
    expect(useWorkspaceSurfaceStore.getState().currentOsSessionId).toBe('os-new-1');
  });

  it('commits a pending session shell before metadata I/O completes', async () => {
    let resolveMetadata!: (metadata: SessionMetadata | null) => void;
    sessionApiMock.loadSessionMetadata.mockImplementationOnce(() => (
      new Promise((resolve) => { resolveMetadata = resolve; })
    ));

    const opening = openSession('runno-session', { commitPendingSurface: true });

    expect(useWorkspaceSurfaceStore.getState().activeSurface).toEqual({
      kind: 'session',
      sessionId: 'runno-session',
    });
    resolveMetadata(agenticOsMetadata({
      sessionId: 'runno-session',
      sessionName: 'Runno',
      agentType: 'Runno',
    }));
    await opening;

    expect(useWorkspaceSurfaceStore.getState().activeSurface).toEqual({
      kind: 'session',
      sessionId: 'runno-session',
    });
    expect(activateSessionDataMock).toHaveBeenCalledWith('runno-session');
  });

  it('restores the previous surface when a pending session no longer exists', async () => {
    sessionApiMock.loadSessionMetadata.mockResolvedValue(null);

    await openSession('missing-session', { commitPendingSurface: true });

    expect(useWorkspaceSurfaceStore.getState().activeSurface).toEqual(createAgenticOsHomeSurface());
  });

  it('uses one stable baseline for overlapping pending shells', async () => {
    const releases = new Map<string, (metadata: SessionMetadata | null) => void>();
    sessionApiMock.loadSessionMetadata.mockImplementation((sessionId: string) => (
      new Promise((resolve) => { releases.set(sessionId, resolve); })
    ));

    const openingA = openSession('missing-a', { commitPendingSurface: true });
    const openingB = openSession('missing-b', { commitPendingSurface: true });
    expect(useWorkspaceSurfaceStore.getState().activeSurface).toEqual({
      kind: 'session',
      sessionId: 'missing-b',
    });

    releases.get('missing-b')?.(null);
    await expect(openingB).resolves.toBe('missing');
    releases.get('missing-a')?.(null);
    await expect(openingA).resolves.toBe('superseded');

    expect(useWorkspaceSurfaceStore.getState().activeSurface).toEqual(createAgenticOsHomeSurface());
  });

  it('prevents an older session lookup from committing after a newer intent is reserved', async () => {
    let release!: (metadata: SessionMetadata | null) => void;
    sessionApiMock.loadSessionMetadata.mockImplementationOnce(() => (
      new Promise((resolve) => { release = resolve; })
    ));
    const epoch = beginNavigationIntent();
    const opening = openSession('late-session', {
      commitPendingSurface: true,
      navigationEpoch: epoch,
    });

    beginNavigationIntent();
    release(agenticOsMetadata({
      sessionId: 'late-session',
      sessionName: 'Late',
      agentType: 'Runno',
    }));

    await expect(opening).resolves.toBe('superseded');
    expect(useWorkspaceSurfaceStore.getState().activeSurface).toEqual(createAgenticOsHomeSurface());
    expect(activateSessionDataMock).not.toHaveBeenCalledWith('late-session');
  });

  it('cancels a pending shell when Back has no history entry', async () => {
    let release!: (metadata: SessionMetadata | null) => void;
    sessionApiMock.loadSessionMetadata.mockImplementationOnce(() => (
      new Promise((resolve) => { release = resolve; })
    ));
    const opening = openSession('pending-back', { commitPendingSurface: true });

    expect(goBackScene()).toBe(true);
    expect(useWorkspaceSurfaceStore.getState().activeSurface).toEqual(createAgenticOsHomeSurface());
    release(null);
    await expect(opening).resolves.toBe('superseded');
  });

  it('never records a pending shell in scene history', async () => {
    useWorkspaceSurfaceStore.setState({
      activeSurface: { kind: 'session', sessionId: 'stable-session' },
      previousSurface: createAgenticOsHomeSurface(),
      sceneHistory: [],
    });
    let release!: (metadata: SessionMetadata | null) => void;
    sessionApiMock.loadSessionMetadata.mockImplementationOnce(() => (
      new Promise((resolve) => { release = resolve; })
    ));
    const opening = openSession('pending-settings', { commitPendingSurface: true });

    openScene('settings');
    expect(useWorkspaceSurfaceStore.getState().sceneHistory[0]?.surface).toEqual({
      kind: 'session',
      sessionId: 'stable-session',
    });
    release(null);
    await expect(opening).resolves.toBe('superseded');

    expect(goBackScene()).toBe(true);
    expect(useWorkspaceSurfaceStore.getState().activeSurface).toEqual({
      kind: 'session',
      sessionId: 'stable-session',
    });
  });

  it('replaces a provisional Work shell without adding it to history', async () => {
    const epoch = beginNavigationIntent();
    expect(commitPendingSessionNavigation('pending-work:excel', {
      context: { kind: 'work', workId: 'excel' },
      navigationEpoch: epoch,
    })).toBe(true);
    await flowChatStore.hydrateWorkspaceSessionsMetadata([
      agenticOsMetadata({
        sessionId: 'excel-real-session',
        sessionName: 'Excel',
        agentType: 'Runno',
      }),
    ], '', 'agentic_os');

    await expect(openSession('optimistic-reservation-b', {
      context: { kind: 'work', workId: 'excel' },
      commitPendingSurface: true,
      navigationEpoch: epoch,
      resolveSession: async () => (
        flowChatStore.getState().sessions.get('excel-real-session') ?? null
      ),
    })).resolves.toBe('opened');

    expect(useWorkspaceSurfaceStore.getState().sceneHistory).toEqual([]);
    expect(goBackScene()).toBe(false);
    expect(useWorkspaceSurfaceStore.getState().activeSurface).toEqual({
      kind: 'session',
      sessionId: 'excel-real-session',
    });
  });
});
