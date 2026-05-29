import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TaskDetailPanel } from './TaskDetailPanel';
import type { FlowSubagentExecutionProjection, FlowToolItem } from '../../types/flow-chat';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/design-system', () => ({
  DotMatrixLoader: () => <div data-testid="loader" />,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../execution', () => ({
  useSubagentExecution: () => null,
}));

vi.mock('../FlowTextBlock', () => ({
  FlowTextBlock: ({ textItem }: { textItem: { content: string } }) => (
    <div data-testid="detail-flow-text-block">{textItem.content}</div>
  ),
}));

vi.mock('../FlowToolCard', () => ({
  FlowToolCard: ({ toolItem }: { toolItem: { toolName: string } }) => (
    <div data-testid="detail-flow-tool-card">{toolItem.toolName}</div>
  ),
}));

vi.mock('../../tool-cards/ModelThinkingDisplay', () => ({
  ModelThinkingDisplay: ({ thinkingItem }: { thinkingItem: { content: string } }) => (
    <div data-testid="detail-thinking-display">{thinkingItem.content}</div>
  ),
}));

const projection: FlowSubagentExecutionProjection = {
  id: 'parent-session:task-1',
  kind: 'subagentRun',
  edgeKind: 'delegates',
  parentSessionId: 'parent-session',
  parentTurnId: 'turn-1',
  parentToolId: 'task-1',
  childSessionId: 'child-session',
  items: [
    {
      id: 'thinking-1',
      type: 'thinking',
      content: 'Recovered reasoning',
      isStreaming: false,
      isCollapsed: true,
      timestamp: 1,
      status: 'completed',
    },
    {
      id: 'tool-1',
      type: 'tool',
      toolName: 'Grep',
      toolCall: { input: { pattern: 'needle' }, id: 'tool-1' },
      timestamp: 2,
      status: 'completed',
    },
  ],
  summary: {
    status: 'completed',
    latestLabel: 'Grep completed',
    latestToolName: 'Grep',
    updatedAt: 3,
  },
  createdAt: 1,
  updatedAt: 3,
};

const taskTool: FlowToolItem = {
  id: 'task-1',
  type: 'tool',
  toolName: 'Task',
  toolCall: {
    id: 'task-1',
    input: {
      description: 'Find references',
      prompt: 'Find every reference',
      subagent_type: 'Explore',
    },
  },
  toolResult: {
    result: 'done',
    success: true,
  },
  timestamp: 1,
  status: 'completed',
  executionProjection: projection,
};

describe('TaskDetailPanel subagent projection rendering', () => {
  it('renders completed subagent details from the persisted parent Task projection', () => {
    const html = renderToStaticMarkup(
      <TaskDetailPanel
        data={{
          toolItem: taskTool,
          taskInput: taskTool.toolCall.input,
          sessionId: 'parent-session',
        }}
      />
    );

    expect(html).toContain('data-testid="detail-thinking-display"');
    expect(html).toContain('Recovered reasoning');
    expect(html).toContain('data-testid="detail-flow-tool-card"');
    expect(html).toContain('Grep');
  });
});
