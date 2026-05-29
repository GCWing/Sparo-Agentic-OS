import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TaskToolDisplay } from './TaskToolDisplay';
import type { FlowSubagentExecutionProjection, FlowToolItem } from '../types/flow-chat';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/design-system', () => ({
  Button: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
}));

vi.mock('@/shared/markdown/Markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}));

vi.mock('../execution', () => ({
  useSubagentExecution: () => null,
}));

vi.mock('../components/FlowTextBlock', () => ({
  FlowTextBlock: ({ textItem }: { textItem: { content: string } }) => (
    <div data-testid="flow-text-block">{textItem.content}</div>
  ),
}));

vi.mock('../components/FlowToolCard', () => ({
  FlowToolCard: ({ toolItem, className }: { toolItem: { toolName: string }; className?: string }) => (
    <div data-testid="flow-tool-card" className={className}>{toolItem.toolName}</div>
  ),
}));

vi.mock('./ModelThinkingDisplay', () => ({
  ModelThinkingDisplay: ({ thinkingItem }: { thinkingItem: { content: string } }) => (
    <div data-testid="model-thinking-display">{thinkingItem.content}</div>
  ),
}));

vi.mock('./useToolCardHeightContract', () => ({
  useToolCardHeightContract: () => ({
    cardRootRef: { current: null },
    applyExpandedState: (
      _currentExpanded: boolean,
      nextExpanded: boolean,
      setExpanded: (value: boolean) => void,
    ) => setExpanded(nextExpanded),
  }),
}));

vi.mock('./templates', () => ({
  HeavyToolCardTemplate: ({
    title,
    headerSubline,
    expandedContent,
  }: {
    title: React.ReactNode;
    headerSubline?: React.ReactNode;
    expandedContent?: React.ReactNode;
  }) => (
    <section>
      <div data-testid="task-title">{title}</div>
      <div data-testid="task-subline">{headerSubline}</div>
      <div data-testid="task-expanded">{expandedContent}</div>
    </section>
  ),
  renderHeavyToolRunningStatus: () => null,
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
      id: 'text-1',
      type: 'text',
      content: 'Recovered child output',
      isStreaming: false,
      isMarkdown: true,
      timestamp: 1,
      status: 'completed',
    },
    {
      id: 'tool-1',
      type: 'tool',
      toolName: 'Read',
      toolCall: { input: { file_path: 'src/main.ts' }, id: 'tool-1' },
      timestamp: 2,
      status: 'completed',
    },
  ],
  summary: {
    status: 'completed',
    latestLabel: 'Read completed',
    latestDetail: 'src/main.ts',
    latestToolName: 'Read',
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
      description: 'Explore implementation',
      prompt: 'Inspect the implementation',
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

describe('TaskToolDisplay subagent projection rendering', () => {
  it('renders the persisted subagent line under the header and reuses FlowToolCard for child tools', () => {
    const html = renderToStaticMarkup(
      <TaskToolDisplay
        toolItem={taskTool}
        sessionId="parent-session"
      />
    );

    expect(html).toContain('task-subagent-live-line');
    expect(html).toContain('Read completed');
    expect(html).toContain('src/main.ts');
    expect(html).toContain('data-testid="flow-text-block"');
    expect(html).toContain('Recovered child output');
    expect(html).toContain('data-testid="flow-tool-card"');
    expect(html).toContain('task-subagent-nested-tool-card');
  });
});
