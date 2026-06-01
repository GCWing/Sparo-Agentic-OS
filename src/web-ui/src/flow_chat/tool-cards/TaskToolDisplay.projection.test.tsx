/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskToolDisplay } from './TaskToolDisplay';
import type { FlowSubagentExecutionProjection, FlowToolItem } from '../types/flow-chat';
import { taskCollapseStateManager } from '../store/TaskCollapseStateManager';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/design-system', () => ({
  Button: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  Tooltip: ({ children, content }: { children: React.ReactNode; content: React.ReactNode }) => (
    <span data-tooltip-content={String(content)}>{children}</span>
  ),
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

vi.mock('../scroll/useFlowLayoutMutationContract', () => ({
  useFlowLayoutMutationContract: () => ({
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
    meta,
    headerSubline,
    expandedContent,
    isExpanded,
  }: {
    title: React.ReactNode;
    meta?: React.ReactNode;
    headerSubline?: React.ReactNode;
    expandedContent?: React.ReactNode;
    isExpanded?: boolean;
  }) => (
    <section data-expanded={String(Boolean(isExpanded))}>
      <div data-testid="task-title">{title}</div>
      <div data-testid="task-meta">{meta}</div>
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
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    taskCollapseStateManager.clearAll();
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    host?.remove();
    root = null;
    host = null;
    taskCollapseStateManager.clearAll();
  });

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

  it('keeps restart-interrupted task cards collapsed by default and marks the folded header', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    act(() => {
      root?.render(
        <TaskToolDisplay
          toolItem={{
            ...taskTool,
            id: 'task-interrupted',
            status: 'cancelled',
            interruptionReason: 'app_restart',
          }}
          sessionId="parent-session"
          interruptionNote="This tool was still running when the app closed last time"
        />,
      );
    });

    expect(host.querySelector('section')?.getAttribute('data-expanded')).toBe('false');
    expect(host.querySelector('.task-interruption-indicator')).not.toBeNull();
    expect(host.querySelector('[data-tooltip-content="This tool was still running when the app closed last time"]')).not.toBeNull();
  });
});
