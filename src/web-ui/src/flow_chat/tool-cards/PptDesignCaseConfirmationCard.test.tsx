/**
 * @vitest-environment jsdom
 */

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowToolItem, ToolCardConfig } from '../types/flow-chat';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  convertFileSrc: vi.fn((filePath: string) => `http://asset.localhost/${encodeURIComponent(filePath)}`),
  submitUserAnswers: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: mocks.convertFileSrc,
}));

vi.mock('@/infrastructure/api/service-api/ToolAPI', () => ({
  toolAPI: { submitUserAnswers: mocks.submitUserAnswers },
}));

vi.mock('@/infrastructure/runtime', () => ({
  isTauriRuntime: () => true,
}));

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/design-system', () => ({
  Button: ({ children, isLoading: _isLoading, ...props }: any) => React.createElement('button', props, children),
  Textarea: ({ autoResize: _autoResize, ...props }: any) => React.createElement('textarea', props),
  DotMatrixLoader: () => React.createElement('span', { 'data-testid': 'loader' }),
  CubeLoading: () => React.createElement('span', { 'data-testid': 'cube' }),
  IconButton: ({ children, ...props }: any) => React.createElement('button', props, children),
  Tooltip: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));

import { PptDesignCaseConfirmationCard } from './PptDesignCaseConfirmationCard';

const config: ToolCardConfig = {
  toolName: 'agentcomponent__builtin-ppt-live-agent__confirm_design_case',
  displayName: 'Confirm Design Case',
  icon: 'GalleryHorizontal',
  requiresConfirmation: false,
  resultDisplayType: 'detailed',
};

function runningTool(): FlowToolItem {
  return {
    id: 'case-tool',
    type: 'tool',
    toolName: config.toolName,
    timestamp: 1,
    status: 'running',
    toolCall: {
      id: 'case-tool',
      input: {
        caseId: 'case-1',
        density: 'balanced',
        colorDirection: {
          keywords: ['editorial', 'precise'],
          audienceFit: 'Executive review',
        },
        sampleSlides: [1, 2, 3].map((number) => ({
          slideId: `p0${number}`,
          title: `Page ${number}`,
          pageRole: number === 1 ? 'cover' : 'evidence',
          previewRef: `C:\\renders\\case-${number}.png`,
        })),
      },
    },
    runtime: {
      lifecycle: 'running',
      inputPhase: 'parsed',
      confirmation: 'none',
      input: undefined,
    },
  };
}

describe('PptDesignCaseConfirmationCard', () => {
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    host?.remove();
    host = null;
    mocks.convertFileSrc.mockClear();
    mocks.submitUserAnswers.mockReset();
  });

  it('renders three real page previews and resumes the waiting tool with approval', async () => {
    const tool = runningTool();
    tool.runtime!.input = tool.toolCall.input;
    host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<PptDesignCaseConfirmationCard toolItem={tool} config={config} />);
    });

    const previews = [...host.querySelectorAll('img')];
    expect(previews).toHaveLength(3);
    expect(mocks.convertFileSrc).toHaveBeenCalledTimes(3);
    expect(mocks.convertFileSrc).toHaveBeenNthCalledWith(1, 'C:\\renders\\case-1.png');
    expect(previews[0]?.getAttribute('src')).toBe('http://asset.localhost/C%3A%5Crenders%5Ccase-1.png');
    const approve = [...host.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('toolCards.pptDesignCase.approveAction'));
    expect(approve).toBeTruthy();

    await act(async () => {
      approve!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(mocks.submitUserAnswers).toHaveBeenCalledWith('case-tool', {
      decision: 'approved',
      actor: 'user',
      reviewCapability: 'multimodal',
      feedback: '',
    });

    await act(async () => root.unmount());
  });
});
