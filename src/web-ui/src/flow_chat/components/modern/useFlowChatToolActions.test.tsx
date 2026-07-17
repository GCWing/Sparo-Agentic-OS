/**
 * @vitest-environment jsdom
 */

import React, { useEffect } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DialogTurn, FlowToolItem } from '../../types/flow-chat';
import { flowChatStore } from '../../store/FlowChatStore';
import { useFlowChatToolActions } from './useFlowChatToolActions';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  ensureBackendSession: vi.fn(),
  confirmToolExecution: vi.fn(),
}));

vi.mock('../../services/FlowChatManager', () => ({
  flowChatManager: {
    ensureBackendSession: mocks.ensureBackendSession,
  },
}));

vi.mock('@/shared/services/agent-service', () => ({
  agentService: {
    confirmToolExecution: mocks.confirmToolExecution,
  },
}));

type ToolActions = ReturnType<typeof useFlowChatToolActions>;

function Probe({
  onReady,
  mutationsDisabled = false,
}: {
  onReady: (actions: ToolActions) => void;
  mutationsDisabled?: boolean;
}) {
  const actions = useFlowChatToolActions({ mutationsDisabled });

  useEffect(() => {
    onReady(actions);
  }, [actions, onReady]);

  return null;
}

function addPendingTool(sessionId: string, toolId: string, input: unknown): string {
  const turnId = `${sessionId}-turn`;
  const tool: FlowToolItem = {
    id: toolId,
    type: 'tool',
    toolName: 'settings_change_preview',
    toolCall: { id: toolId, input },
    timestamp: 1,
    status: 'pending_confirmation',
    requiresConfirmation: true,
  };
  const turn: DialogTurn = {
    id: turnId,
    sessionId,
    userMessage: { id: `${sessionId}-message`, content: '调整设置', timestamp: 1 },
    modelRounds: [{
      id: `${sessionId}-round`,
      index: 0,
      items: [tool],
      isStreaming: false,
      isComplete: false,
      status: 'pending_confirmation',
      startTime: 1,
    }],
    status: 'processing',
    startTime: 1,
  };

  flowChatStore.createSession(sessionId, {});
  flowChatStore.addDialogTurn(sessionId, turn);
  return turnId;
}

describe('useFlowChatToolActions', () => {
  let host: HTMLDivElement;
  let root: Root;
  let actions: ToolActions | undefined;
  const sessionIds: string[] = [];
  const onReady = (nextActions: ToolActions) => {
    actions = nextActions;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureBackendSession.mockResolvedValue(undefined);
    mocks.confirmToolExecution.mockResolvedValue(undefined);
    actions = undefined;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    act(() => {
      root.render(<Probe onReady={onReady} />);
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    sessionIds.splice(0).forEach(sessionId => flowChatStore.removeSession(sessionId));
  });

  it('confirms the original settings preview without sending it as edited input', async () => {
    const sessionId = 'settings-confirm-original';
    const toolId = 'settings-tool-original';
    const originalInput = { changes: [{ settingId: 'appearance.fontSize', value: 18 }] };
    const turnId = addPendingTool(sessionId, toolId, originalInput);
    sessionIds.push(sessionId);

    await act(async () => {
      await actions?.handleToolConfirm(toolId);
    });

    expect(mocks.confirmToolExecution).toHaveBeenCalledWith(
      sessionId,
      toolId,
      'confirm',
      undefined,
    );
    const confirmed = flowChatStore.findToolItem(sessionId, turnId, toolId) as FlowToolItem;
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.toolCall.input).toEqual(originalInput);
  });

  it('sends and optimistically renders explicitly edited input for editable tools', async () => {
    const sessionId = 'regular-confirm-edited';
    const toolId = 'editable-tool';
    const turnId = addPendingTool(sessionId, toolId, { command: 'pnpm test' });
    const updatedInput = { command: 'pnpm test -- --runInBand' };
    sessionIds.push(sessionId);

    await act(async () => {
      await actions?.handleToolConfirm(toolId, updatedInput);
    });

    expect(mocks.confirmToolExecution).toHaveBeenCalledWith(
      sessionId,
      toolId,
      'confirm',
      updatedInput,
    );
    const confirmed = flowChatStore.findToolItem(sessionId, turnId, toolId) as FlowToolItem;
    expect(confirmed.toolCall.input).toEqual(updatedInput);
  });

  it('blocks confirm and reject mutations under a read-only host policy', async () => {
    const sessionId = 'settings-read-only';
    const toolId = 'settings-read-only-tool';
    const turnId = addPendingTool(sessionId, toolId, { action: 'apply' });
    sessionIds.push(sessionId);

    act(() => {
      root.render(<Probe onReady={onReady} mutationsDisabled />);
    });

    await act(async () => {
      await actions?.handleToolConfirm(toolId);
      await actions?.handleToolReject(toolId);
    });

    expect(mocks.ensureBackendSession).not.toHaveBeenCalled();
    expect(mocks.confirmToolExecution).not.toHaveBeenCalled();
    const pending = flowChatStore.findToolItem(sessionId, turnId, toolId) as FlowToolItem;
    expect(pending.status).toBe('pending_confirmation');
  });
});
