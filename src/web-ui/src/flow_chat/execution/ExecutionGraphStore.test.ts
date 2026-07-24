import { describe, expect, it } from 'vitest';
import { createExecutionGraphStore } from './ExecutionGraphStore';
import type { ExecutionNode } from './types';

const identity = {
  nodeId: 'parent-session:task-1',
  parentSessionId: 'parent-session',
  parentTurnId: 'turn-1',
  parentToolId: 'task-1',
  childSessionId: 'child-session',
};

describe('ExecutionGraphStore', () => {
  it('builds a subagent execution timeline from text and tool events', () => {
    const store = createExecutionGraphStore();

    store.ingestText(identity, {
      roundId: 'round-1',
      text: 'Reading files',
      contentType: 'text',
    });
    const node = store.ingestToolEvent(identity, {
      event_type: 'Started',
      tool_id: 'tool-1',
      tool_name: 'Read',
      params: { file_path: 'src/main.ts' },
    });

    expect(node.items).toHaveLength(2);
    expect(node.summary.latestToolName).toBe('Read');
    expect(node.summary.latestDetail).toBe('src/main.ts');
    expect(store.getNode(identity.parentSessionId, identity.parentToolId)).toBe(node);
  });

  it('finalizes streaming child items when the subagent completes', () => {
    const store = createExecutionGraphStore();

    store.ingestText(identity, {
      roundId: 'round-1',
      text: 'partial',
      contentType: 'text',
    });
    store.ingestToolEvent(identity, {
      event_type: 'Started',
      tool_id: 'tool-1',
      tool_name: 'Grep',
      params: { pattern: 'needle' },
    });

    const node = store.finalizeNodeByParent(identity, 'completed');

    expect(node.summary.status).toBe('completed');
    expect(node.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'text', isStreaming: false, status: 'completed' }),
        expect.objectContaining({
          type: 'tool',
          status: 'completed',
          runtime: expect.objectContaining({
            lifecycle: 'completed',
            inputPhase: 'parsed',
          }),
        }),
      ])
    );
  });

  it('finalizes prior streaming text when a child tool starts', () => {
    const store = createExecutionGraphStore();

    const afterText = store.ingestText(identity, {
      roundId: 'round-1',
      text: 'I found the likely file.',
      contentType: 'text',
    });
    expect(afterText.items[0]).toEqual(
      expect.objectContaining({ type: 'text', isStreaming: true, status: 'streaming' })
    );

    const afterTool = store.ingestToolEvent(identity, {
      event_type: 'Started',
      tool_id: 'tool-1',
      tool_name: 'Read',
      params: { file_path: 'src/main.ts' },
    });

    expect(afterTool.items[0]).toEqual(
      expect.objectContaining({ type: 'text', isStreaming: false, status: 'completed' })
    );
    expect(afterTool.items[1]).toEqual(
      expect.objectContaining({ type: 'tool', id: 'tool-1', status: 'running' })
    );
  });

  it('finalizes prior streaming text when a later child text round starts', () => {
    const store = createExecutionGraphStore();

    store.ingestText(identity, {
      roundId: 'round-1',
      text: 'First completed answer.',
      contentType: 'text',
    });
    const node = store.ingestText(identity, {
      roundId: 'round-2',
      text: 'Continuing with another answer.',
      contentType: 'text',
    });

    expect(node.items[0]).toEqual(
      expect.objectContaining({ type: 'text', isStreaming: false, status: 'completed' })
    );
    expect(node.items[1]).toEqual(
      expect.objectContaining({ type: 'text', isStreaming: true, status: 'streaming' })
    );
  });

  it('preserves terminal child tool failures when the subagent later completes', () => {
    const store = createExecutionGraphStore();

    store.ingestToolEvent(identity, {
      event_type: 'Failed',
      tool_id: 'tool-1',
      tool_name: 'Read',
      error: 'missing file',
    });

    const node = store.finalizeNodeByParent(identity, 'completed');

    expect(node.summary.status).toBe('completed');
    expect(node.items[0]).toEqual(
      expect.objectContaining({
        type: 'tool',
        status: 'error',
        toolResult: expect.objectContaining({
          success: false,
          error: 'missing file',
        }),
      })
    );
  });

  it('fills the parent turn id when it arrives after the first child event', () => {
    const store = createExecutionGraphStore();
    const earlyIdentity = {
      ...identity,
      parentTurnId: undefined,
    };

    store.ingestText(earlyIdentity, {
      roundId: 'round-1',
      text: 'early output',
      contentType: 'text',
    });
    const node = store.ingestToolEvent(identity, {
      event_type: 'Started',
      tool_id: 'tool-1',
      tool_name: 'Read',
      params: { file_path: 'README.md' },
    });

    expect(node.parentTurnId).toBe(identity.parentTurnId);
  });

  it('uses the terminal subagent label when no child output arrived', () => {
    const store = createExecutionGraphStore();

    const node = store.finalizeNodeByParent(identity, 'completed');

    expect(node.summary).toEqual(
      expect.objectContaining({
        status: 'completed',
        latestLabel: 'Subagent completed',
      })
    );
  });

  it('hydrates persisted projections for restart recovery', () => {
    const store = createExecutionGraphStore();
    const persisted: ExecutionNode = {
      id: identity.nodeId,
      kind: 'subagentRun',
      edgeKind: 'delegates',
      parentSessionId: identity.parentSessionId,
      parentTurnId: identity.parentTurnId,
      parentToolId: identity.parentToolId,
      childSessionId: identity.childSessionId,
      items: [
        {
          id: 'text-1',
          type: 'text',
          content: 'Recovered detail',
          isStreaming: false,
          isMarkdown: true,
          timestamp: 1,
          status: 'completed',
        },
      ],
      summary: {
        status: 'completed',
        latestLabel: 'Recovered detail',
        updatedAt: 2,
      },
      createdAt: 1,
      updatedAt: 2,
    };

    const node = store.hydrateNode(persisted);

    expect(node).toEqual(expect.objectContaining(persisted));
    expect(store.getNode(identity.parentSessionId, identity.parentToolId)?.items[0]).toEqual(
      expect.objectContaining({ content: 'Recovered detail' })
    );
  });

  it('does not let late child events revive a terminal node', () => {
    const store = createExecutionGraphStore();

    const finalized = store.finalizeNodeByParent(identity, 'completed');
    const late = store.ingestText(identity, {
      roundId: 'round-late',
      text: 'late output',
      contentType: 'text',
    });

    expect(late).toEqual(finalized);
    expect(late.items).toHaveLength(0);
    expect(late.summary.status).toBe('completed');
  });

  it('does not promote a completed child item to terminal subagent status', () => {
    const store = createExecutionGraphStore();

    const afterThinking = store.ingestText(identity, {
      roundId: 'round-1',
      text: 'thinking is done',
      contentType: 'thinking',
      isThinkingEnd: true,
    });
    const afterTool = store.ingestToolEvent(identity, {
      event_type: 'Started',
      tool_id: 'tool-1',
      tool_name: 'Read',
      params: { file_path: 'README.md' },
    });

    expect(afterThinking.summary.status).toBe('running');
    expect(afterThinking.nodeState?.status).toBe('running');
    expect(afterTool.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'tool', id: 'tool-1', status: 'running' }),
      ])
    );
  });

  it('does not promote a completed child tool to terminal subagent status', () => {
    const store = createExecutionGraphStore();

    const afterCompletedTool = store.ingestToolEvent(identity, {
      event_type: 'Completed',
      tool_id: 'tool-1',
      tool_name: 'Read',
      result: { ok: true },
    });
    const afterNextText = store.ingestText(identity, {
      roundId: 'round-2',
      text: 'continuing after tool',
      contentType: 'text',
    });

    expect(afterCompletedTool.summary.status).toBe('running');
    expect(afterCompletedTool.nodeState?.status).toBe('running');
    expect(afterNextText.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'text', content: 'continuing after tool' }),
      ])
    );
  });

  it('keeps accepting child events while the subagent node is draining', () => {
    const store = createExecutionGraphStore();

    const draining = store.beginNodeDrain(identity, 'completed');
    const withText = store.ingestText(identity, {
      roundId: 'round-final',
      text: 'final answer',
      contentType: 'text',
    });
    const withTool = store.ingestToolEvent(identity, {
      event_type: 'Completed',
      tool_id: 'tool-final',
      tool_name: 'Read',
      result: { ok: true },
    });

    expect(draining.summary.status).toBe('draining');
    expect(withText.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'text', content: 'final answer' }),
      ])
    );
    expect(withTool.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'tool', status: 'completed' }),
      ])
    );
  });

  it('keeps execution summary on node-level status for child input streaming', () => {
    const store = createExecutionGraphStore();

    const node = store.ingestToolEvent(identity, {
      event_type: 'ParamsPartial',
      tool_id: 'tool-1',
      tool_name: 'Write',
      params: '{"file_path":"src/main.ts"',
    });

    expect(node.summary.status).toBe('preparing');
    expect(node.summary.activity).toBe('receiving_tool_input');
  });

});
