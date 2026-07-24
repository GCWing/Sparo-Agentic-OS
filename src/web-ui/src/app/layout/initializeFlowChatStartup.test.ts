import { describe, expect, it, vi } from 'vitest';
import {
  initializeFlowChatStartup,
  shouldOpenDefaultAgenticOsAtStartup,
} from './initializeFlowChatStartup';

describe('initializeFlowChatStartup', () => {
  it('selects Agentic OS by default when no project workspace is available', () => {
    expect(shouldOpenDefaultAgenticOsAtStartup({
      alreadyApplied: false,
      hasWorkspace: false,
    })).toBe(true);
    expect(shouldOpenDefaultAgenticOsAtStartup({
      alreadyApplied: false,
      preferredMode: 'Runno',
      hasWorkspace: false,
    })).toBe(true);
  });

  it('opens the default Agentic OS session without requiring a project workspace', async () => {
    const calls: string[] = [];
    const initializeSessionRuntime = vi.fn(async () => {
      calls.push('runtime');
    });
    const initializeWorkspaceSessionState = vi.fn();
    const commitStartupHome = vi.fn(() => {
      calls.push('home');
    });
    const openAgenticOsSession = vi.fn(async () => {
      calls.push('os-agent');
      return 'os-session-1';
    });

    const result = await initializeFlowChatStartup({
      manager: {
        initializeSessionRuntime,
        initializeWorkspaceSessionState,
      },
      workspace: null,
      openDefaultAgenticOs: true,
      commitStartupHome,
      openAgenticOsSession,
    });

    expect(result).toEqual({
      agenticOsSessionId: 'os-session-1',
      workspaceInitialization: null,
    });
    expect(calls).toEqual(['home', 'runtime', 'os-agent']);
    expect(initializeWorkspaceSessionState).not.toHaveBeenCalled();
  });

  it('keeps workspace initialization as an optional branch after OS startup', async () => {
    const calls: string[] = [];
    const initializeWorkspaceSessionState = vi.fn(async () => {
      calls.push('workspace');
      return {
        focusedSessionId: null,
      };
    });

    const result = await initializeFlowChatStartup({
      manager: {
        initializeSessionRuntime: vi.fn(async () => {
          calls.push('runtime');
        }),
        initializeWorkspaceSessionState,
      },
      workspace: {
        id: 'workspace-1',
        name: 'Workspace',
        rootPath: 'D:/workspace/example',
      },
      openDefaultAgenticOs: true,
      commitStartupHome: () => {
        calls.push('home');
      },
      openAgenticOsSession: async () => {
        calls.push('os-agent');
        return 'os-session-1';
      },
    });

    expect(calls).toEqual(['home', 'runtime', 'os-agent', 'workspace']);
    expect(result.workspaceInitialization?.createdSessionId).toBeUndefined();
    expect(initializeWorkspaceSessionState).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'workspace-1' }),
      expect.objectContaining({
        skipAutoSelectSession: true,
        createDefaultSession: false,
      }),
    );
  });
});
