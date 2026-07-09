/**
 * @vitest-environment jsdom
 */

import React, { useEffect } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { descriptorFromAgentType } from '../domain/sessionDescriptor';
import { flowChatStore } from '../store/FlowChatStore';
import type { Session } from '../types/flow-chat';
import { useFlowChatStoreSelector } from './useFlowChatStoreSelector';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function makeSession(sessionId: string, agentType: string): Session {
  const descriptor = descriptorFromAgentType(agentType);

  return {
    sessionId,
    title: sessionId,
    titleStatus: 'generated',
    dialogTurns: [],
    status: 'idle',
    config: {
      agentType: descriptor.agentPolicy.activeAgentId,
      modelName: 'primary',
    },
    createdAt: 1_000,
    lastActiveAt: 1_000,
    error: null,
    loadPhase: 'metadata-only',
    descriptor,
    workspacePath:
      descriptor.storageScope === 'agentic_os'
        ? 'C:/Users/HUAWEI/AppData/Roaming/sparo_os/agentic_os'
        : 'D:/workspace/Sparo_OS_WorkSpace/Sparo-Agentic-OS',
    storageScope: descriptor.storageScope,
    sessionKind: 'normal',
  };
}

function resetStore(): void {
  flowChatStore.setState(prev => ({
    ...prev,
    sessions: new Map(),
  }));
}

function ProfileProbe({
  focusedSessionId,
  onValue,
}: {
  focusedSessionId: string;
  onValue: (value: string | undefined) => void;
}) {
  const profileId = useFlowChatStoreSelector(state =>
    state.sessions.get(focusedSessionId)?.descriptor.profileId
  );

  useEffect(() => {
    onValue(profileId);
  }, [onValue, profileId]);

  return null;
}

describe('useFlowChatStoreSelector', () => {
  let host: HTMLDivElement;
  let root: Root;
  let latestProfileId: string | undefined;

  beforeEach(() => {
    latestProfileId = undefined;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    resetStore();

    flowChatStore.setState(prev => ({
      ...prev,
      sessions: new Map([
        ['coder-session', makeSession('coder-session', 'bitfun-coder')],
        ['os-session', makeSession('os-session', 'OSAgent')],
      ]),
    }));
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    resetStore();
    host.remove();
  });

  it('recomputes when selector closure dependencies change without a FlowChatStore state change', () => {
    act(() => {
      root.render(
        <ProfileProbe
          focusedSessionId="coder-session"
          onValue={value => {
            latestProfileId = value;
          }}
        />
      );
    });

    expect(latestProfileId).toBe('bitfun-coder');

    act(() => {
      root.render(
        <ProfileProbe
          focusedSessionId="os-session"
          onValue={value => {
            latestProfileId = value;
          }}
        />
      );
    });

    expect(latestProfileId).toBe('agentic-os');
  });
});
