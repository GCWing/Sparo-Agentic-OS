/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AppDefinedToolCardField, FlowToolItem, ToolCardConfig } from '../types/flow-chat';
import { AppDefinedToolCard } from './AppDefinedToolCard';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/design-system', () => ({
  Button: ({ children, className, disabled, onClick, title, type = 'button' }: any) => (
    <button className={className} disabled={disabled} onClick={onClick} title={title} type={type}>
      {children}
    </button>
  ),
  CubeLoading: () => <span data-testid="cube-loading" />,
  IconButton: ({ children, className, disabled, onClick, ...rest }: any) => (
    <button
      aria-label={rest['aria-label']}
      aria-controls={rest['aria-controls']}
      aria-expanded={rest['aria-expanded']}
      className={className}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function config(fields: AppDefinedToolCardField[] = []): ToolCardConfig {
  return {
    toolName: 'agentcomponent__excel-live-agent__get_workbook_meta',
    displayName: 'Workbook Meta',
    icon: 'Info',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-component-fg)',
    extensionCard: {
      kind: 'appDefined',
      family: 'excel-live',
      template: 'compact',
      title: 'Workbook Meta',
      icon: 'Info',
      summary: {
        preparing: 'Preparing workbook meta',
        running: 'Reading workbook meta',
        completed: 'Workbook meta loaded',
        failed: 'Workbook meta failed',
      },
      fields,
    },
  };
}

function tool(overrides: Partial<FlowToolItem> = {}): FlowToolItem {
  return {
    id: 'tool-1',
    type: 'tool',
    toolName: 'agentcomponent__excel-live-agent__get_workbook_meta',
    toolCall: {
      id: 'tool-1',
      input: { workbookId: 'book-1' },
    },
    timestamp: 1,
    status: 'preparing',
    runtime: {
      lifecycle: 'preparing',
      inputPhase: 'parsed',
      confirmation: 'none',
      input: { workbookId: 'book-1' },
    },
    ...overrides,
  };
}

describe('AppDefinedToolCard', () => {
  it('renders manifest identity and completed copy in the system compact status line', () => {
    const html = renderToStaticMarkup(
      <AppDefinedToolCard
        config={config([{ label: 'Workbook', inputPath: ['workbookId'] }])}
        toolItem={tool({
          status: 'completed',
          runtime: {
            lifecycle: 'completed',
            inputPhase: 'parsed',
            confirmation: 'none',
            input: { workbookId: 'book-1' },
          },
          toolResult: {
            success: true,
            result: { bridge: { status: 'completed', output: { meta: { title: 'Budget' } } } },
          },
        })}
      />,
    );

    expect(html).toContain('app-defined-tool-card--excel-live');
    expect(html).toContain('compact-card-status-icon--expandable');
    expect(html).not.toContain('tool-card-icon-slot');
    expect(html).not.toContain('lucide-info');
    expect(html).toContain('Workbook Meta:');
    expect(html).toContain('Workbook meta loaded');
  });

  it('keeps confirm and cancel actions visible for mutating extension tools', () => {
    const html = renderToStaticMarkup(
      <AppDefinedToolCard
        config={config([{ label: 'Workbook', inputPath: ['workbookId'] }])}
        toolItem={tool({
          status: 'pending_confirmation',
          requiresConfirmation: true,
          runtime: {
            lifecycle: 'waiting_confirmation',
            inputPhase: 'parsed',
            confirmation: 'required',
            input: { workbookId: 'book-1' },
          },
        })}
        onConfirm={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(html).toContain('requires-confirmation');
    expect(html).toContain('toolCards.default.waitingConfirm');
    expect(html).toContain('aria-label="toolCards.mcp.confirmExecute"');
    expect(html).toContain('aria-label="toolCards.mcp.cancel"');
  });

  it('does not render no-op confirmation controls when the host has no callbacks', () => {
    const html = renderToStaticMarkup(
      <AppDefinedToolCard
        config={config()}
        toolItem={tool({
          status: 'pending_confirmation',
          requiresConfirmation: true,
          runtime: {
            lifecycle: 'waiting_confirmation',
            inputPhase: 'parsed',
            confirmation: 'required',
            input: { workbookId: 'book-1' },
          },
        })}
      />,
    );

    expect(html).not.toContain('aria-label="toolCards.mcp.confirmExecute"');
    expect(html).not.toContain('aria-label="toolCards.mcp.cancel"');
  });

  it('submits the current input through compact confirmation actions', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onConfirm = vi.fn();
    const onReject = vi.fn();

    act(() => {
      root.render(
        <AppDefinedToolCard
          config={config()}
          toolItem={tool({
            status: 'pending_confirmation',
            requiresConfirmation: true,
            runtime: {
              lifecycle: 'waiting_confirmation',
              inputPhase: 'parsed',
              confirmation: 'required',
              input: { workbookId: 'book-1' },
            },
          })}
          onConfirm={onConfirm}
          onReject={onReject}
        />,
      );
    });

    act(() => {
      host.querySelector<HTMLButtonElement>('[aria-label="toolCards.mcp.confirmExecute"]')?.click();
      host.querySelector<HTMLButtonElement>('[aria-label="toolCards.mcp.cancel"]')?.click();
    });

    expect(onConfirm).toHaveBeenCalledWith({ workbookId: 'book-1' });
    expect(onReject).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    host.remove();
  });

  it('maps bridge failures to the extension failed state even when the tool transport completed', () => {
    const html = renderToStaticMarkup(
      <AppDefinedToolCard
        config={config()}
        toolItem={tool({
          status: 'completed',
          runtime: {
            lifecycle: 'completed',
            inputPhase: 'parsed',
            confirmation: 'none',
            input: { workbookId: 'book-1' },
          },
          toolResult: {
            success: true,
            result: {
              bridge: {
                status: 'failed',
                output: { message: 'Workbook is locked' },
              },
            },
          },
        })}
      />,
    );

    expect(html).toContain('Workbook meta failed');
    expect(html).toContain('status-error');
    expect(html).not.toContain('status-completed');
  });

  it('prefers the grounded engine summary for completed no-op results', () => {
    const html = renderToStaticMarkup(
      <AppDefinedToolCard
        config={config()}
        toolItem={tool({
          status: 'completed',
          runtime: {
            lifecycle: 'completed',
            inputPhase: 'parsed',
            confirmation: 'none',
            input: { workbookId: 'book-1' },
          },
          toolResult: {
            success: true,
            result: { bridge: { status: 'completed', output: { summary: 'Nothing to undo' } } },
          },
        })}
      />,
    );

    expect(html).toContain('Nothing to undo');
    expect(html).not.toContain('Workbook meta loaded');
  });

  it('does not expose an empty disclosure before a field or result is available', () => {
    const html = renderToStaticMarkup(
      <AppDefinedToolCard config={config()} toolItem={tool()} />,
    );

    expect(html).not.toContain('compact-card-status-icon--expandable');
  });

  it('falls back to a bounded structured result when the manifest has no fields', () => {
    const html = renderToStaticMarkup(
      <AppDefinedToolCard
        config={config()}
        toolItem={tool({
          status: 'completed',
          runtime: {
            lifecycle: 'completed',
            inputPhase: 'parsed',
            confirmation: 'none',
            input: { workbookId: 'book-1' },
          },
          toolResult: {
            success: true,
            result: { bridge: { status: 'completed', output: { revision: 4, entries: [] } } },
          },
        })}
      />,
    );

    expect(html).toContain('compact-card-status-icon--expandable');
  });

  it.each([0, false])('keeps scalar result %s available through disclosure', (output) => {
    const html = renderToStaticMarkup(
      <AppDefinedToolCard
        config={config()}
        toolItem={tool({
          status: 'completed',
          runtime: {
            lifecycle: 'completed',
            inputPhase: 'parsed',
            confirmation: 'none',
            input: { workbookId: 'book-1' },
          },
          toolResult: {
            success: true,
            result: { bridge: { status: 'completed', output } },
          },
        })}
      />,
    );

    expect(html).toContain('compact-card-status-icon--expandable');
  });

  it('supports non-bridge Agent Component result envelopes', () => {
    const html = renderToStaticMarkup(
      <AppDefinedToolCard
        config={config()}
        toolItem={tool({
          status: 'completed',
          runtime: {
            lifecycle: 'completed',
            inputPhase: 'parsed',
            confirmation: 'none',
            input: { workbookId: 'book-1' },
          },
          toolResult: {
            success: true,
            result: {
              component_id: 'excel-live-agent',
              tool: 'custom_probe',
              result: { summary: 'Probe returned no changes', changed: false },
            },
          },
        })}
      />,
    );

    expect(html).toContain('Probe returned no changes');
    expect(html).toContain('compact-card-status-icon--expandable');
  });

  it('keeps Excel family cards compact even if a future manifest asks for detail mode', () => {
    const detailedConfig = config([{ label: 'Workbook', inputPath: ['workbookId'] }]);
    detailedConfig.displayMode = 'detailed';
    if (detailedConfig.extensionCard) detailedConfig.extensionCard.template = 'detail';

    const html = renderToStaticMarkup(
      <AppDefinedToolCard config={detailedConfig} toolItem={tool()} />,
    );

    expect(html).toContain('compact-tool-card');
    expect(html).not.toContain('base-tool-card');
  });

  it('preserves cancelled presentation when the transport result is unsuccessful', () => {
    const html = renderToStaticMarkup(
      <AppDefinedToolCard
        config={config()}
        toolItem={tool({
          status: 'cancelled',
          runtime: {
            lifecycle: 'cancelled',
            inputPhase: 'parsed',
            confirmation: 'none',
            input: { workbookId: 'book-1' },
          },
          toolResult: {
            success: false,
            error: 'Tool execution cancelled',
          },
        })}
      />,
    );

    expect(html).toContain('status-cancelled');
    expect(html).toContain('toolCards.default.cancelled');
    expect(html).not.toContain('status-error');
  });

  it('keeps detail failure disclosure controls connected to the error region', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const detailedConfig = config();
    detailedConfig.displayMode = 'detailed';
    if (detailedConfig.extensionCard) {
      detailedConfig.extensionCard.family = 'custom-bridge';
      detailedConfig.extensionCard.template = 'detail';
    }

    act(() => {
      root.render(
        <AppDefinedToolCard
          config={detailedConfig}
          toolItem={tool({
            status: 'completed',
            runtime: {
              lifecycle: 'completed',
              inputPhase: 'parsed',
              confirmation: 'none',
              input: { workbookId: 'book-1' },
            },
            toolResult: {
              success: false,
            },
          })}
        />,
      );
    });

    const expandButton = host.querySelector<HTMLButtonElement>('[aria-label="toolCards.common.expand"]');
    const controlsId = expandButton?.getAttribute('aria-controls');

    act(() => expandButton?.click());

    expect(controlsId).toBeTruthy();
    expect(Boolean(
      controlsId
      && document.getElementById(controlsId)?.classList.contains('base-tool-card-error'),
    )).toBe(true);
    expect(host.textContent).toContain('toolCards.default.failed');

    act(() => root.unmount());
    host.remove();
  });

  it('exposes a keyboard-operable disclosure with expanded state and controls', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        <AppDefinedToolCard
          config={config([{ label: 'Workbook', inputPath: ['workbookId'] }])}
          toolItem={tool()}
        />,
      );
    });

    const expandButton = host.querySelector<HTMLButtonElement>('[aria-label="toolCards.common.expand"]');
    expect(expandButton?.getAttribute('aria-expanded')).toBe('false');
    const controlsId = expandButton?.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();

    act(() => expandButton?.click());

    const collapseButton = host.querySelector<HTMLButtonElement>('[aria-label="toolCards.common.collapse"]');
    expect(collapseButton?.getAttribute('aria-expanded')).toBe('true');
    expect(controlsId && document.getElementById(controlsId)).toBeTruthy();

    act(() => root.unmount());
    host.remove();
  });
});
