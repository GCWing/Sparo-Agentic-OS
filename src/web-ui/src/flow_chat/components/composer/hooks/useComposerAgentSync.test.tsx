/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentAction } from '../../../reducers/agentReducer';
import { SESSION_DESCRIPTORS, type SessionDescriptor } from '../../../domain/sessionDescriptor';
import { useComposerAgentSync } from './useComposerAgentSync';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  watch: vi.fn(),
  listAgents: vi.fn(),
}));

vi.mock('@/infrastructure/config/services/ConfigManager', () => ({
  configManager: {
    watch: mocks.watch,
  },
}));

vi.mock('@/infrastructure/api/service-api/AgentAPI', () => ({
  agentAPI: {
    listAgents: mocks.listAgents,
  },
}));

interface ProbeProps {
  descriptor: SessionDescriptor;
  explicitTargetSessionId: string;
  allowGlobalAgentSync: boolean;
  dispatchMode: React.Dispatch<AgentAction>;
}

function Probe({
  descriptor,
  explicitTargetSessionId,
  allowGlobalAgentSync,
  dispatchMode,
}: ProbeProps) {
  useComposerAgentSync({
    activeSessionDescriptor: descriptor,
    dispatchMode,
    explicitTargetSessionId,
    effectiveTargetSessionId: explicitTargetSessionId,
    allowGlobalAgentSync,
  });
  return null;
}

function dispatchSessionSwitch(sessionId: string, descriptor: SessionDescriptor) {
  window.dispatchEvent(new CustomEvent('sparo:session-switched', {
    detail: { sessionId, descriptor },
  }));
}

describe('useComposerAgentSync', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    mocks.watch.mockReturnValue(() => undefined);
    mocks.listAgents.mockReturnValue(new Promise(() => undefined));
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it('keeps a fixed settings composer isolated from global session switches and preferences', () => {
    const dispatchMode = vi.fn<React.Dispatch<AgentAction>>();

    act(() => {
      root.render(
        <Probe
          descriptor={SESSION_DESCRIPTORS.settings}
          explicitTargetSessionId="settings-session"
          allowGlobalAgentSync={false}
          dispatchMode={dispatchMode}
        />,
      );
    });

    expect(dispatchMode).toHaveBeenCalledWith({
      type: 'SET_CURRENT_AGENT',
      payload: 'SettingsAgent',
    });
    expect(sessionStorage.getItem('sparo:flowchat:lastAgent')).toBeNull();
    dispatchMode.mockClear();

    act(() => {
      dispatchSessionSwitch('main-session', SESSION_DESCRIPTORS.runno);
      dispatchSessionSwitch('settings-session', SESSION_DESCRIPTORS.settings);
    });

    expect(dispatchMode).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('sparo:flowchat:lastAgent')).toBeNull();
  });

  it('only applies global switch events addressed to an explicit composer session', () => {
    const dispatchMode = vi.fn<React.Dispatch<AgentAction>>();

    act(() => {
      root.render(
        <Probe
          descriptor={SESSION_DESCRIPTORS.runno}
          explicitTargetSessionId="target-session"
          allowGlobalAgentSync
          dispatchMode={dispatchMode}
        />,
      );
    });
    dispatchMode.mockClear();

    act(() => {
      dispatchSessionSwitch('other-session', SESSION_DESCRIPTORS.design);
    });
    expect(dispatchMode).not.toHaveBeenCalled();

    act(() => {
      dispatchSessionSwitch('target-session', SESSION_DESCRIPTORS.design);
    });
    expect(dispatchMode).toHaveBeenCalledWith({
      type: 'SET_CURRENT_AGENT',
      payload: 'Design',
    });
    expect(sessionStorage.getItem('sparo:flowchat:lastAgent')).toBe('Design');
  });
});
