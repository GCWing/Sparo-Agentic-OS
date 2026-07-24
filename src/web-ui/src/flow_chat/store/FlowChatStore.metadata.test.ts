// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionMetadata } from '@/shared/types/session-history';
import { getDefaultSessionDescriptor } from '@/flow_chat/domain/sessionDescriptor';
import { FlowChatStore } from './FlowChatStore';

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
    domain: { kind: 'workspace', workspace_id: 'bulk-workspace' },
  };
}

describe('FlowChatStore metadata hydration', () => {
  beforeEach(() => {
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
    );
    unsubscribe();

    expect(inserted).toBe(100);
    expect(notificationCount).toBe(1);
    expect(store.getState().sessions.get('bulk-session-0')?.maxContextTokens).toBeUndefined();
    expect(store.getState().sessions.get('bulk-session-1')?.maxContextTokens).toBeUndefined();
  });

  it('clears local history warm state when a managed session is detached', () => {
    const store = FlowChatStore.getInstance();
    store.createSession('managed-session', { domain: { kind: 'os_agent' } });
    store.markSessionHistoryWarmed('managed-session');

    store.removeSession('managed-session');

    expect(store.hasSessionHistoryWarmed('managed-session')).toBe(false);
    expect(store.getState().sessions.has('managed-session')).toBe(false);
  });

  it('invalidates backend-derived context data when the session model changes', () => {
    const store = FlowChatStore.getInstance();
    store.createSession(
      'model-change-session',
      { modelName: 'model-a', domain: { kind: 'os_agent' } },
      undefined,
      'Model change',
      128128,
    );
    store.updateContextBudget('model-change-session', {
      id: 'budget-a',
      kind: 'static',
      sessionId: 'model-change-session',
      agentType: 'Runno',
      modelId: 'model-a',
      provider: 'test',
      contextWindow: 128128,
      totals: {
        inputTokens: 100,
        reservedOutputTokens: 0,
        remainingTokens: 128028,
        usedRatio: 100 / 128128,
      },
      estimation: {
        algorithm: 'test',
        confidence: 'approx',
        calibrated: false,
      },
      segments: [],
      createdAt: 1,
    });

    store.updateSessionModelName('model-change-session', 'model-b');

    const session = store.getState().sessions.get('model-change-session');
    expect(session?.config.modelName).toBe('model-b');
    expect(session?.currentContextBudget).toBeUndefined();
    expect(session?.maxContextTokens).toBeUndefined();
  });

  it('can invalidate a resolved budget after model capability settings change', () => {
    const store = FlowChatStore.getInstance();
    store.createSession(
      'capability-change-session',
      { modelName: 'model-a', domain: { kind: 'os_agent' } },
      undefined,
      'Capability change',
      128128,
    );

    store.invalidateSessionContextBudget('capability-change-session');

    expect(
      store.getState().sessions.get('capability-change-session')?.maxContextTokens,
    ).toBeUndefined();
  });

  it('lets authoritative Product App metadata replace a newer temporary shell', async () => {
    const store = FlowChatStore.getInstance();
    const sessionId = 'ppt-live-session';
    const workspacePath = 'D:/workspace/ppt';
    const domain = { kind: 'workspace' as const, workspace_id: 'ppt-workspace' };
    store.addExternalSession(
      sessionId,
      'PPT Live',
      getDefaultSessionDescriptor(),
      workspacePath,
      undefined,
      domain,
    );
    const temporaryUpdatedAt =
      store.getState().sessions.get(sessionId)?.lastActiveAt ?? Date.now();
    const metadata: SessionMetadata = {
      sessionId,
      domain,
      sessionName: 'PPT Live',
      agentType: 'builtin-ppt-live-agent',
      modelName: 'primary',
      createdAt: 1,
      lastActiveAt: 2,
      turnCount: 0,
      messageCount: 0,
      toolCallCount: 0,
      status: 'active',
      tags: [],
      workspacePath,
      customMetadata: {
        productAppRuntime: {
          appId: 'builtin-ppt-live',
          releaseId: 'release-ppt-live',
          appName: 'PPT Live',
          hostSurfaceId: 'ppt-live-surface',
          profile: 'product-app-runtime',
          scope: {
            kind: 'workspace',
            workspaceId: 'ppt-workspace',
            workspacePath,
          },
          chat: {
            agentType: 'builtin-ppt-live-agent',
          },
          tabs: [],
        },
      },
    };

    await store.hydrateWorkspaceSessionsMetadata([metadata], workspacePath);

    const session = store.getState().sessions.get(sessionId);
    expect(session?.descriptor.hostKind).toBe('product-app-runtime');
    expect(session?.descriptor.agentPolicy.activeAgentId).toBe('builtin-ppt-live-agent');
    expect(session?.config.agentType).toBe('builtin-ppt-live-agent');
    expect(session?.updatedAt).toBe(temporaryUpdatedAt);

    await store.hydrateWorkspaceSessionsMetadata([{
      ...metadata,
      agentType: 'Runno',
      lastActiveAt: temporaryUpdatedAt + 1,
      customMetadata: undefined,
    }], workspacePath);

    expect(
      store.getState().sessions.get(sessionId)?.descriptor.hostKind,
    ).toBe('product-app-runtime');
  });
});
