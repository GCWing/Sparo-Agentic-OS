/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesignTokensProposalCard } from './DesignTokensProposalCard';
import type { FlowToolItem, ToolCardConfig } from '../types/flow-chat';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/design-system', () => ({
  Button: ({ children, className, disabled, title, type = 'button' }: any) => (
    <button className={className} disabled={disabled} title={title} type={type}>
      {children}
    </button>
  ),
  DotMatrixLoader: () => <span data-testid="dot-loader" />,
  IconButton: ({ children, className, onClick, type = 'button', ...rest }: any) => (
    <button
      aria-label={rest['aria-label']}
      className={className}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/infrastructure/contexts/WorkspaceContext', () => ({
  useLastUsedWorkspace: () => ({ workspacePath: 'D:/workspace/project' }),
}));

vi.mock('@/tools/design-canvas', () => ({
  designTokensAPI: {
    awaitSelection: vi.fn(),
    commit: vi.fn(),
  },
}));

vi.mock('@/shared/services/ide-control', () => ({
  ideControl: {
    panel: {
      open: vi.fn(),
    },
  },
}));

vi.mock('@/infrastructure/api/service-api/ToolAPI', () => ({
  toolAPI: {
    submitUserAnswers: vi.fn(),
  },
}));

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('./BaseToolCard', () => ({
  BaseToolCard: ({ className, header, expandedContent, isExpanded, onClick }: any) => (
    <section className={className} data-expanded={String(Boolean(isExpanded))} onClick={onClick}>
      <div data-testid="tool-header">{header}</div>
      {isExpanded && <div data-testid="tool-body">{expandedContent}</div>}
    </section>
  ),
}));

vi.mock('./ToolArtifactFrame', () => ({
  ToolArtifactFrame: ({ children, error, loading }: any) => (
    <div data-loading={String(Boolean(loading))}>
      {error || children}
    </div>
  ),
}));

vi.mock('./ToolErrorBlock', () => ({
  ToolErrorBlock: ({ title, message }: any) => (
    <div>
      {title}
      {message}
    </div>
  ),
}));

vi.mock('./ToolHeaderLayout', () => ({
  ToolHeaderLayout: ({ content, extra, icon }: any) => (
    <header>
      {icon}
      {content}
      {extra}
    </header>
  ),
  ToolCompactHeaderLayout: ({ action, content, extra, statusIcon }: any) => (
    <header>
      {statusIcon}
      {action}
      {content}
      {extra}
    </header>
  ),
}));

const config: ToolCardConfig = {
  toolName: 'DesignTokens',
  displayName: 'Design Tokens',
  icon: 'DT',
  requiresConfirmation: false,
  resultDisplayType: 'detailed',
};

const proposal = {
  id: 'editorial-ink',
  name: 'Editorial Ink',
  mood: 'Restrained editorial system',
  colors: {
    primary: 'var(--ds-color-accent-500)',
    background: 'var(--ds-color-bg-scene)',
    surface: 'var(--ds-color-surface-base)',
    text: 'var(--ds-color-text-primary)',
  },
  typography: {
    fontFamily: 'Inter, sans-serif',
    scale: {
      display: '36px',
      body: '15px',
    },
  },
  radius: { md: '8px' },
  shadow: { md: 'var(--ds-shadow-sm)' },
  motion: {},
  component_samples: {},
};

const alternateProposal = {
  ...proposal,
  id: 'quiet-system',
  name: 'Quiet System',
};

function designTokensTool(action: string): FlowToolItem {
  return {
    id: `tool-${action}`,
    type: 'tool',
    toolName: 'DesignTokens',
    toolCall: {
      id: `tool-${action}`,
      input: {
        action,
        artifact_id: 'daily-letter-scene',
        proposals: action === 'propose' ? [proposal, alternateProposal] : undefined,
      },
    },
    toolResult: {
      success: true,
      result: {
        success: true,
        tokens_event: action === 'get' ? 'tokens-preview' : 'tokens-committed',
        data: {
          path: 'D:/workspace/project/.design/daily-letter-scene/tokens.json',
          tokens: {
            version: 1,
            proposals: [proposal, alternateProposal],
            committed_id: 'editorial-ink',
          },
        },
      },
    },
    timestamp: 1,
    status: 'completed',
  };
}

describe('DesignTokensProposalCard', () => {
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    host?.remove();
    root = null;
    host = null;
  });

  it('renders get results as a compact committed-token summary', () => {
    const html = renderToStaticMarkup(
      <DesignTokensProposalCard toolItem={designTokensTool('get')} config={config} />,
    );

    expect(html).toContain('toolCards.designTokens.currentSystemSummary');
    expect(html).toContain('Editorial Ink');
    expect(html).toContain('read-file-name');
    expect(html).toContain('design-tokens-proposal-card__compact-swatches');
    expect(html).not.toContain('read-file-meta');
    expect(html).not.toContain('design-tokens-proposal-card__list');
    expect(html).not.toContain('toolCards.designTokens.switchToThisSystem');
  });

  it('keeps propose results in the proposal picker layout', () => {
    const html = renderToStaticMarkup(
      <DesignTokensProposalCard toolItem={designTokensTool('propose')} config={config} />,
    );

    expect(html).toContain('toolCards.designTokens.cardTitle');
    expect(html).toContain('design-tokens-proposal-card__list');
    expect(html).toContain('Quiet System');
    expect(html).toContain('design-tokens-proposal-card__collapsed-name');
  });

  it('lets proposal cards collapse from the header', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    act(() => {
      root?.render(
        <DesignTokensProposalCard toolItem={designTokensTool('propose')} config={config} />,
      );
    });

    expect(host.querySelector('.design-tokens-proposal-card')?.getAttribute('data-expanded')).toBe('true');
    expect(host.querySelector('[data-testid="tool-body"]')).not.toBeNull();

    act(() => {
      (host?.querySelector('.design-tokens-proposal-card') as HTMLElement).click();
    });

    expect(host.querySelector('.design-tokens-proposal-card')?.getAttribute('data-expanded')).toBe('false');
    expect(host.querySelector('[data-testid="tool-body"]')).toBeNull();
  });
});
