import { describe, expect, it } from 'vitest';
import { deriveToolRuntimeState } from './statusModel';
import { getToolViewState } from './toolViewState';
import type { FlowToolItem } from '../types/flow-chat';

function tool(overrides: Partial<FlowToolItem>): FlowToolItem {
  return {
    id: 'tool-1',
    type: 'tool',
    timestamp: 1,
    status: 'preparing',
    toolName: 'Write',
    toolCall: {
      id: 'tool-1',
      input: {},
    },
    ...overrides,
  } as FlowToolItem;
}

describe('runtime status model', () => {
  it('treats parameter streaming as input phase, not execution', () => {
    const runtime = deriveToolRuntimeState(tool({
      status: 'receiving',
      runtime: {
        lifecycle: 'preparing',
        inputPhase: 'streaming',
        confirmation: 'none',
        input: {},
        partialInput: { file_path: 'src/main.ts' },
      },
    }));

    expect(runtime.lifecycle).toBe('preparing');
    expect(runtime.inputPhase).toBe('streaming');
    expect(getToolViewState(tool({
      status: 'receiving',
      runtime: {
        lifecycle: 'preparing',
        inputPhase: 'streaming',
        confirmation: 'none',
        input: {},
      },
    })).phase).toBe('receiving_input');
  });

  it('turns rejected confirmation into cancelled lifecycle', () => {
    const runtime = deriveToolRuntimeState(tool({
      status: 'pending_confirmation',
      requiresConfirmation: true,
      userConfirmed: false,
    }));

    expect(runtime.confirmation).toBe('rejected');
    expect(runtime.lifecycle).toBe('cancelled');
  });
});
