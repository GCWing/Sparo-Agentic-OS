/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductAppHostSurface } from '@/infrastructure/api/service-api/ProductAppRuntimeHostAPI';
import { useExcelLiveFocusStore } from '@/app/agentic-os/excel-live/excelLiveFocusStore';
import ProductAppRuntimeIframeHost from './ProductAppRuntimeIframeHost';
import {
  useProductAppRuntimeBridge,
  type ProductAppRuntimeBridgeOptions,
} from './useProductAppRuntimeBridge';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('./useProductAppRuntimeBridge', () => ({
  useProductAppRuntimeBridge: vi.fn(),
}));

vi.mock('@/tools/markdown', async () => {
  const ReactModule = await import('react');
  return {
    MarkdownEditor: (props: {
      fileName?: string;
      initialContent?: string;
      onContentChange?: (content: string, dirty: boolean) => void;
      onSave?: (content: string) => void;
    }) => ReactModule.createElement('button', {
      type: 'button',
      'data-hosted-markdown-editor': props.fileName,
      onClick: () => props.onContentChange?.('# Updated', true),
      onDoubleClick: () => props.onSave?.('# Updated'),
    }, props.initialContent),
  };
});

vi.mock('@/infrastructure/theme/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {},
  }),
}));

vi.mock('@/infrastructure/i18n', () => ({
  useI18n: () => ({
    currentLanguage: 'en-US',
  }),
}));

vi.mock('./productAppRuntimeThemeVars', () => ({
  buildProductAppRuntimeThemeVars: () => null,
}));

vi.mock('./productAppRuntimeHostMeta', () => ({
  resolveProductAppHostSurfaceMeta: (app: ProductAppHostSurface) => ({
    name: app.name,
    description: app.description,
    tags: app.tags ?? [],
  }),
}));

const app: ProductAppHostSurface = {
  id: 'app-1',
  name: 'App One',
  description: 'Preview app',
  icon: { kind: 'monogram', label: 'App One' },
  category: 'test',
  tags: [],
  i18n: { locales: {} },
  version: 1,
  created_at: 1,
  updated_at: 1,
  source: {
    html: '<main id="app-root"></main>',
    css: '',
    ui_js: '',
    esm_dependencies: [],
    i18n_messages: {},
    worker_js: '',
    npm_dependencies: [],
    entry: {
      uiEntry: 'ui.js',
      workerEntry: 'worker.js',
      styleEntries: ['style.css'],
      buildMode: 'nativeEsm',
    },
    source_files: [],
  },
  compiled_html: '<!doctype html><html><body><main id="app-root"></main></body></html>',
  permissions: {},
  backends: [],
  runtime: {
    source_revision: 'src:1',
    deps_revision: '',
    deps_dirty: false,
    worker_restart_required: false,
    ui_recompile_required: false,
  },
};

const excelLiveApp: ProductAppHostSurface = {
  ...app,
  id: 'builtin-excel-live',
  name: 'Excel Live',
};

function setAmbientFocusForSession(sessionId: string): void {
  useExcelLiveFocusStore.getState().setAmbientFocus({
    sessionId,
    workbookId: 'workbook-1',
    sheetId: 'sheet-1',
    sheetName: 'Sheet 1',
    a1: 'A1',
    rowCount: 1,
    columnCount: 1,
  });
}

describe('Product App runtime host adapter preview observation', () => {
  let container: HTMLDivElement;
  let root: Root;
  let bridgeOptions: ProductAppRuntimeBridgeOptions | undefined;

  beforeEach(() => {
    vi.mocked(useProductAppRuntimeBridge).mockImplementation((_iframeRef, _app, options) => {
      bridgeOptions = options;
    });
    useExcelLiveFocusStore.setState({ ambient: null, ambientBySessionId: {}, includeOnSend: true });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    useExcelLiveFocusStore.setState({ ambient: null, ambientBySessionId: {}, includeOnSend: true });
    container.remove();
    vi.clearAllMocks();
  });

  it('renders the system Markdown editor for a hosted document view', () => {
    act(() => {
      root.render(<ProductAppRuntimeIframeHost app={app} />);
    });

    expect(bridgeOptions?.hostedViews).toBeDefined();
    act(() => {
      bridgeOptions?.hostedViews?.mount({
        viewId: 'manuscript',
        kind: 'markdown-editor',
        rect: { x: 12, y: 48, width: 600, height: 420, visible: true },
        options: {
          content: '# Manuscript',
          fileName: 'manuscript.md',
          savedVersion: 1,
          showToolbar: false,
        },
      });
    });

    const editor = container.querySelector<HTMLButtonElement>('[data-hosted-markdown-editor="manuscript.md"]');
    expect(editor?.textContent).toBe('# Manuscript');
    expect(editor?.parentElement?.style.left).toBe('12px');

    const iframe = container.querySelector('iframe');
    const postMessage = vi.spyOn(iframe!.contentWindow!, 'postMessage');
    act(() => editor?.click());
    expect(postMessage).toHaveBeenCalledWith({
      type: 'sparo:event',
      event: 'hostedView:change',
      payload: { viewId: 'manuscript', content: '# Updated', dirty: true },
    }, '*');
  });

  it('grants only iframe features declared by the surface', () => {
    act(() => {
      root.render(
        <ProductAppRuntimeIframeHost
          app={{
            ...app,
            permissions: {
              iframe: { autoplay: true, fullscreen: true },
            },
          }}
        />,
      );
    });

    expect(container.querySelector('iframe')?.getAttribute('allow')).toBe('autoplay; fullscreen');
  });

  it('waits for iframe runtime-ready bridge message before reporting preview load', () => {
    const onPreviewLoad = vi.fn();
    const onPreviewInteractionProbe = vi.fn();
    const onPreviewUserPathRehearsal = vi.fn();

    act(() => {
      root.render(
        <ProductAppRuntimeIframeHost
          app={app}
          onPreviewLoad={onPreviewLoad}
          onPreviewInteractionProbe={onPreviewInteractionProbe}
          onPreviewUserPathRehearsal={onPreviewUserPathRehearsal}
          userPathRehearsalPlan={{
            version: 1,
            scenarios: [{
              id: 'new-user-smoke',
              title: 'Try App One',
              kind: 'user-path',
              steps: [
                { id: 'open-app', action: 'open', expect: ['App One'] },
                { id: 'focus-first-action', action: 'focus', target: 'first interactive control', expect: ['App One'] },
              ],
            }],
          }}
          previewBootTimeoutMs={60_000}
        />,
      );
    });

    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    const postMessage = vi.spyOn(iframe!.contentWindow!, 'postMessage');

    act(() => {
      iframe!.dispatchEvent(new Event('load'));
    });
    expect(onPreviewLoad).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sparo:event',
        event: 'runtimeReadyProbe',
      }),
      '*',
    );

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: iframe!.contentWindow,
        data: {
          method: 'sparo/runtime-ready',
          params: {
            appId: 'app-1',
            hostSurfaceId: 'app-1',
            sourceRevision: 'src:1',
            depsRevision: '',
            depsDirty: false,
            workerRestartRequired: false,
            readyState: 'interactive',
            metrics: {
              bodyChildCount: 1,
              visibleElementCount: 3,
              interactiveElementCount: 1,
              viewportWidth: 1280,
              viewportHeight: 720,
              scrollWidth: 1280,
              scrollHeight: 900,
            },
            timestampMs: 42,
          },
        },
      }));
    });

    expect(onPreviewLoad).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'app-1',
      hostSurfaceId: 'app-1',
      readyState: 'interactive',
      sourceRevision: 'src:1',
      depsRevision: '',
      depsDirty: false,
      workerRestartRequired: false,
      timestampMs: 42,
      metrics: expect.objectContaining({
        bodyChildCount: 1,
        visibleElementCount: 3,
        interactiveElementCount: 1,
        viewportWidth: 1280,
        viewportHeight: 720,
      }),
    }));
    expect(onPreviewLoad).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sparo:event',
        event: 'runtimeInteractionProbe',
      }),
      '*',
    );
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sparo:event',
        event: 'runtimeUserPathRehearsal',
        payload: expect.objectContaining({
          scenarios: expect.arrayContaining([
            expect.objectContaining({ id: 'new-user-smoke' }),
          ]),
        }),
      }),
      '*',
    );

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: iframe!.contentWindow,
        data: {
          method: 'sparo/interaction-probe',
          params: {
            appId: 'app-1',
            route: '/',
            timestampMs: 43,
            probe: {
              candidateCount: 1,
              probed: true,
              focused: true,
              restoredFocus: true,
              targetTag: 'button',
            },
          },
        },
      }));
    });

    expect(onPreviewInteractionProbe).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'app-1',
      timestampMs: 43,
      probe: expect.objectContaining({
        candidateCount: 1,
        probed: true,
        focused: true,
        restoredFocus: true,
        targetTag: 'button',
      }),
    }));

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: iframe!.contentWindow,
        data: {
          method: 'sparo/user-path-rehearsal',
          params: {
            appId: 'app-1',
            route: '/',
            timestampMs: 44,
            result: {
              status: 'passed',
              summary: {
                status: 'passed',
                scenarioCount: 1,
                stepCount: 2,
                passedStepCount: 2,
                failedStepCount: 0,
                notVerifiedStepCount: 0,
                expectationCount: 2,
                verifiedExpectationCount: 2,
                failedExpectationCount: 0,
              },
              scenarios: [{
                id: 'new-user-smoke',
                kind: 'user-path',
                stepCount: 2,
                steps: [
                  {
                    id: 'open-app',
                    action: 'open',
                    status: 'passed',
                    expectationCount: 1,
                    verifiedExpectationCount: 1,
                  },
                  {
                    id: 'focus-first-action',
                    action: 'focus',
                    status: 'passed',
                    targetTag: 'button',
                    expectationCount: 1,
                    verifiedExpectationCount: 1,
                  },
                ],
              }],
            },
          },
        },
      }));
    });

    expect(onPreviewUserPathRehearsal).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'app-1',
      timestampMs: 44,
      result: expect.objectContaining({
        status: 'passed',
        summary: expect.objectContaining({
          scenarioCount: 1,
          stepCount: 2,
          passedStepCount: 2,
        }),
        scenarios: expect.arrayContaining([
          expect.objectContaining({
            id: 'new-user-smoke',
            steps: expect.arrayContaining([
              expect.objectContaining({ id: 'focus-first-action', targetTag: 'button' }),
            ]),
          }),
        ]),
      }),
    }));
  });

  it('does not backfill runtime-ready revisions from host metadata', () => {
    const onPreviewLoad = vi.fn();

    act(() => {
      root.render(
        <ProductAppRuntimeIframeHost
          app={app}
          onPreviewLoad={onPreviewLoad}
          previewBootTimeoutMs={60_000}
        />,
      );
    });

    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: iframe!.contentWindow,
        data: {
          method: 'sparo/runtime-ready',
          params: {
            appId: 'app-1',
            hostSurfaceId: 'app-1',
            readyState: 'interactive',
            depsDirty: false,
            workerRestartRequired: false,
            timestampMs: 42,
          },
        },
      }));
    });

    const readyPayload = onPreviewLoad.mock.calls[0]?.[0];
    expect(onPreviewLoad).toHaveBeenCalledTimes(1);
    expect(readyPayload?.sourceRevision).toBeUndefined();
    expect(readyPayload?.depsRevision).toBeUndefined();
    expect(readyPayload?.depsDirty).toBe(false);
    expect(readyPayload?.workerRestartRequired).toBe(false);
  });

  it('does not backfill runtime-ready host surface identity from host metadata', () => {
    const onPreviewLoad = vi.fn();

    act(() => {
      root.render(
        <ProductAppRuntimeIframeHost
          app={app}
          onPreviewLoad={onPreviewLoad}
          previewBootTimeoutMs={60_000}
        />,
      );
    });

    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: iframe!.contentWindow,
        data: {
          method: 'sparo/runtime-ready',
          params: {
            appId: 'app-1',
            readyState: 'interactive',
            sourceRevision: 'src:1',
            depsRevision: '',
            depsDirty: false,
            workerRestartRequired: false,
            timestampMs: 42,
          },
        },
      }));
    });

    const readyPayload = onPreviewLoad.mock.calls[0]?.[0];
    expect(onPreviewLoad).toHaveBeenCalledTimes(1);
    expect(readyPayload?.hostSurfaceId).toBeUndefined();
    expect(readyPayload?.sourceRevision).toBe('src:1');
    expect(readyPayload?.depsRevision).toBe('');
  });

  it('syncs the spreadsheet focus preference on load and subsequent changes', () => {
    useExcelLiveFocusStore.getState().setIncludeOnSend(false);

    act(() => {
      root.render(<ProductAppRuntimeIframeHost app={excelLiveApp} />);
    });

    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    const postMessage = vi.spyOn(iframe!.contentWindow!, 'postMessage');

    act(() => {
      iframe!.dispatchEvent(new Event('load'));
    });
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'sparo:event',
        event: 'spreadsheetFocusPreferenceChange',
        payload: { includeOnSend: false },
      },
      '*',
    );

    postMessage.mockClear();
    act(() => {
      useExcelLiveFocusStore.getState().setIncludeOnSend(true);
    });
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'sparo:event',
        event: 'spreadsheetFocusPreferenceChange',
        payload: { includeOnSend: true },
      },
      '*',
    );
  });

  it('keeps ambient spreadsheet focus owned by another session on unmount', () => {
    setAmbientFocusForSession('other-session');
    act(() => {
      root.render(
        <ProductAppRuntimeIframeHost app={excelLiveApp} sessionId="host-session" />,
      );
    });

    act(() => {
      root.render(null);
    });

    expect(useExcelLiveFocusStore.getState().ambient?.sessionId).toBe('other-session');
  });

  it('clears ambient spreadsheet focus owned by the same session on unmount', () => {
    setAmbientFocusForSession('host-session');
    act(() => {
      root.render(
        <ProductAppRuntimeIframeHost app={excelLiveApp} sessionId="host-session" />,
      );
    });

    act(() => {
      root.render(null);
    });

    expect(useExcelLiveFocusStore.getState().ambient).toBeNull();
  });

});
