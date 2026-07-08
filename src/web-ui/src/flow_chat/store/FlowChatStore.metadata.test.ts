// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionMetadata } from '@/shared/types/session-history';
import { FlowChatStore } from './FlowChatStore';

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
}));

vi.mock('@/infrastructure/config/services/ConfigManager', () => ({
  configManager: {
    getConfig: mocks.getConfig,
  },
}));

function createMetadata(index: number): SessionMetadata {
  return {
    sessionId: `bulk-session-${index}`,
    sessionName: `Bulk Session ${index}`,
    agentType: 'Runno',
    modelName: index % 2 === 0 ? 'fast-model' : 'primary-model',
    createdAt: index,
    lastActiveAt: 1_000 + index,
    turnCount: 0,
    messageCount: 0,
    toolCallCount: 0,
    status: 'completed',
    tags: [],
    workspacePath: 'D:/workspace/bulk-hydrate',
    storageScope: 'workspace',
  };
}

describe('FlowChatStore metadata hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConfig.mockImplementation(async (path: string) => {
      if (path === 'ai.models') {
        return [
          { id: 'primary-model', name: 'Primary Model', context_window: 128128 },
          { id: 'fast-model', name: 'Fast Model', context_window: 64000 },
        ];
      }
      if (path === 'ai.default_models') {
        return { primary: 'primary-model' };
      }
      return undefined;
    });

    const store = FlowChatStore.getInstance();
    store.setState(() => ({ sessions: new Map() }));
  });

  it('hydrates large metadata batches with one store notification', async () => {
    const store = FlowChatStore.getInstance();
    let notificationCount = 0;
    const unsubscribe = store.subscribeSelector(
      state => state.sessions.size,
      () => {
        notificationCount += 1;
      },
    );

    const metadata = Array.from({ length: 100 }, (_, index) => createMetadata(index));
    const inserted = await store.hydrateWorkspaceSessionsMetadata(
      metadata,
      'D:/workspace/bulk-hydrate',
      'workspace',
    );
    unsubscribe();

    expect(inserted).toBe(100);
    expect(notificationCount).toBe(1);
    expect(mocks.getConfig).toHaveBeenCalledTimes(2);
    expect(store.getState().sessions.get('bulk-session-0')?.maxContextTokens).toBe(64000);
    expect(store.getState().sessions.get('bulk-session-1')?.maxContextTokens).toBe(128128);
  });
});
