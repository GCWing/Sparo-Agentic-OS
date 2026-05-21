import { describe, expect, it } from 'vitest';

import { resolveWorkspaceChatInputMode } from './chatInputMode';

describe('resolveWorkspaceChatInputMode', () => {
  it('keeps unchanged agents as-is', () => {
    expect(
      resolveWorkspaceChatInputMode({
        currentAgent: 'Plan',
        isAssistantWorkspace: false,
        sessionMode: 'Plan',
      })
    ).toBeNull();
  });

  it('syncs when switching between project sessions with different agents', () => {
    expect(
      resolveWorkspaceChatInputMode({
        currentAgent: 'Plan',
        isAssistantWorkspace: false,
        sessionMode: 'agentic',
      })
    ).toBe('agentic');
  });

  it('restores agentic when the current mode is stale', () => {
    expect(
      resolveWorkspaceChatInputMode({
        currentAgent: 'Plan',
        isAssistantWorkspace: false,
        sessionMode: 'agentic',
      })
    ).toBe('agentic');
  });

  it('restores Cowork when the current mode is stale', () => {
    expect(
      resolveWorkspaceChatInputMode({
        currentAgent: 'agentic',
        isAssistantWorkspace: false,
        sessionMode: 'Cowork',
      })
    ).toBe('Cowork');
  });

  it('falls back to agentic if a project session has no mode yet', () => {
    expect(
      resolveWorkspaceChatInputMode({
        currentAgent: 'Plan',
        isAssistantWorkspace: false,
        sessionMode: undefined,
      })
    ).toBeNull();
  });
});
