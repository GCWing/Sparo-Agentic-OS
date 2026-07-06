import { describe, expect, it } from 'vitest';
import { projectProcessingAffordance } from './processingAffordanceProjection';
import type { DialogTurn, FlowTextItem, FlowToolItem, ModelRound, Session } from '../types/flow-chat';

function sessionWith(turn: DialogTurn): Session {
  return {
    sessionId: 'session-1',
    sessionName: 'Session',
    messages: [],
    dialogTurns: [turn],
    metadata: {
      sessionId: 'session-1',
      sessionName: 'Session',
      agentType: 'Runno',
      sessionKind: 'standard',
      storageScope: 'workspace',
      createdAt: 1,
      lastActiveAt: 1,
      turnCount: 1,
      messageCount: 1,
      toolCallCount: 0,
      status: 'active',
      tags: [],
      customMetadata: {},
    },
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
  } as Session;
}

function turnWith(rounds: ModelRound[]): DialogTurn {
  return {
    id: 'turn-1',
    sessionId: 'session-1',
    userMessage: {
      id: 'user-1',
      content: 'hello',
      timestamp: 1,
    },
    modelRounds: rounds,
    status: 'processing',
    startTime: 1,
  };
}

function roundWith(items: ModelRound['items'], overrides: Partial<ModelRound> = {}): ModelRound {
  return {
    id: overrides.id ?? 'round-1',
    index: 0,
    items,
    isStreaming: true,
    isComplete: false,
    status: 'streaming',
    startTime: 1,
    ...overrides,
  };
}

function textItem(overrides: Partial<FlowTextItem> = {}): FlowTextItem {
  return {
    id: 'text-1',
    type: 'text',
    timestamp: 1,
    status: 'streaming',
    content: 'hello',
    isStreaming: true,
    isMarkdown: true,
    ...overrides,
  };
}

function toolItem(overrides: Partial<FlowToolItem> = {}): FlowToolItem {
  return {
    id: 'tool-1',
    type: 'tool',
    timestamp: 1,
    status: 'running',
    toolName: 'WebSearch',
    toolCall: {
      id: 'tool-1',
      input: {},
    },
    runtime: {
      lifecycle: 'running',
      inputPhase: 'parsed',
      confirmation: 'none',
      input: {},
    },
    ...overrides,
  } as FlowToolItem;
}

describe('processing affordance projection', () => {
  it('hides ambient waiting while assistant text is visibly streaming', () => {
    const projection = projectProcessingAffordance({
      session: sessionWith(turnWith([roundWith([textItem()])])),
      isProcessing: true,
      processingPhase: 'streaming',
    });

    expect(projection.kind).toBe('none');
    expect(projection.reserveSpace).toBe(true);
  });

  it('hides ambient waiting while a tool card has its own live affordance', () => {
    const projection = projectProcessingAffordance({
      session: sessionWith(turnWith([roundWith([toolItem()])])),
      isProcessing: true,
      processingPhase: 'tool_calling',
    });

    expect(projection.kind).toBe('none');
    expect(projection.reserveSpace).toBe(true);
  });

  it('shows ambient waiting only when processing is not otherwise represented', () => {
    const projection = projectProcessingAffordance({
      session: sessionWith(turnWith([
        roundWith([
          textItem({
            status: 'completed',
            isStreaming: false,
          }),
        ]),
        roundWith([], { id: 'round-2' }),
      ])),
      isProcessing: true,
      processingPhase: 'thinking',
    });

    expect(projection.kind).toBe('ambient_wait');
    expect(projection.reason).toBe('between_visible_steps');
    expect(projection.reserveSpace).toBe(true);
  });

  it('does not treat an empty backend round as a new visible activity', () => {
    const completedText = textItem({
      id: 'text-complete',
      status: 'completed',
      isStreaming: false,
    });
    const projection = projectProcessingAffordance({
      session: sessionWith(turnWith([
        roundWith([completedText], { id: 'round-1' }),
        roundWith([], { id: 'round-2' }),
      ])),
      isProcessing: true,
      processingPhase: 'thinking',
    });

    expect(projection.kind).toBe('ambient_wait');
    expect(projection.latestVisibleActivityKey).toBe('round-1:text-complete:completed');
  });

  it('uses first-signal waiting before any assistant item exists', () => {
    const projection = projectProcessingAffordance({
      session: sessionWith(turnWith([roundWith([])])),
      isProcessing: true,
      processingPhase: 'thinking',
    });

    expect(projection.kind).toBe('ambient_wait');
    expect(projection.reason).toBe('awaiting_first_signal');
  });

  it('hides during tool confirmation because the confirmation UI owns the state', () => {
    const projection = projectProcessingAffordance({
      session: sessionWith(turnWith([roundWith([toolItem({
        status: 'pending_confirmation',
        requiresConfirmation: true,
        runtime: {
          lifecycle: 'waiting_confirmation',
          inputPhase: 'parsed',
          confirmation: 'required',
          input: {},
        },
      })])])),
      isProcessing: true,
      processingPhase: 'tool_confirming',
    });

    expect(projection.kind).toBe('none');
    expect(projection.reserveSpace).toBe(false);
  });
});
