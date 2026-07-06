import { describe, expect, it } from 'vitest';

import { resolveWorkspaceChatInputMode } from './chatInputMode';

describe('resolveWorkspaceChatInputMode', () => {
  it('keeps unchanged agents as-is', () => {
    expect(
      resolveWorkspaceChatInputMode({
        currentAgent: 'bitfun-plan',
        isAssistantWorkspace: false,
        sessionMode: 'bitfun-plan',
      })
    ).toBeNull();
  });

  it('syncs when switching between project sessions with different agents', () => {
    expect(
      resolveWorkspaceChatInputMode({
        currentAgent: 'bitfun-plan',
        isAssistantWorkspace: false,
        sessionMode: 'bitfun-coder',
      })
    ).toBe('bitfun-coder');
  });

  it('restores BitFun Coder when the current mode is stale', () => {
    expect(
      resolveWorkspaceChatInputMode({
        currentAgent: 'bitfun-plan',
        isAssistantWorkspace: false,
        sessionMode: 'bitfun-coder',
      })
    ).toBe('bitfun-coder');
  });

  it('restores Cowork when the current mode is stale', () => {
    expect(
      resolveWorkspaceChatInputMode({
        currentAgent: 'bitfun-coder',
        isAssistantWorkspace: false,
        sessionMode: 'Cowork',
      })
    ).toBe('Cowork');
  });

  it('keeps the current mode if a project session has no mode yet', () => {
    expect(
      resolveWorkspaceChatInputMode({
        currentAgent: 'bitfun-plan',
        isAssistantWorkspace: false,
        sessionMode: undefined,
      })
    ).toBeNull();
  });
});
