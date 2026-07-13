import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkRecord } from '@/app/agentic-os/work/domain/workTypes';
import type {
  AppDraftRecord,
  IntelligentAppRecord,
} from '@/infrastructure/api/service-api/IntelligentAppAPI';

const mocks = vi.hoisted(() => ({
  resolveComponentWork: vi.fn(),
  openBoundAgentSession: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock('@/app/agentic-os/work/data/workStore', () => ({
  useWorkStore: {
    getState: () => ({ resolveComponentWork: mocks.resolveComponentWork }),
  },
}));

vi.mock('@/flow_chat/domain/sessionDescriptor', () => ({
  SESSION_DESCRIPTORS: { appBuilder: { storageScope: 'agentic_os' } },
}));

vi.mock('@/flow_chat/services/boundAgentSessionService', () => ({
  openBoundAgentSession: mocks.openBoundAgentSession,
}));

vi.mock('@/flow_chat/services/FlowChatManager', () => ({
  flowChatManager: { sendMessage: mocks.sendMessage },
}));

vi.mock('@/infrastructure/api/service-api/IntelligentAppAPI', () => ({
  intelligentAppAPI: { createApp: vi.fn() },
}));

import { openAppBuilderSession } from './openAppBuilderSession';

describe('openAppBuilderSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveComponentWork.mockResolvedValue({
      created: true,
      work: {
        id: 'work-1',
        primarySurface: { kind: 'work_session', sessionId: 'session-1' },
        surfaces: [{ kind: 'work_session', sessionId: 'session-1' }],
        sessionRefs: [{ sessionId: 'session-1', workspacePath: 'D:/workspace/project' }],
      } as unknown as WorkRecord,
    });
    mocks.openBoundAgentSession.mockResolvedValue({ sessionId: 'session-1' });
  });

  it('opens the Work-owned session and never asks the binding service for a standalone session', async () => {
    await openAppBuilderSession({
      app: {
        appId: 'app-1',
        slotId: 'slot-1',
        displayName: 'Research Assistant',
      } as IntelligentAppRecord,
      draft: { draftId: 'draft-1' } as AppDraftRecord,
      scope: { kind: 'workspace', workspacePath: 'D:/workspace/project' },
    });

    expect(mocks.resolveComponentWork).toHaveBeenCalledOnce();
    expect(mocks.openBoundAgentSession).toHaveBeenCalledWith(expect.objectContaining({
      storageScope: 'workspace',
      existingSession: {
        sessionId: 'session-1',
        workspacePath: 'D:/workspace/project',
      },
      context: { kind: 'work', workId: 'work-1' },
      binding: expect.objectContaining({
        executionContext: { workId: 'work-1' },
      }),
    }));
  });
});
