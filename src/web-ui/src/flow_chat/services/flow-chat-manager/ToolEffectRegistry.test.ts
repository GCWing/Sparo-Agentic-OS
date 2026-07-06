import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/agentic-os/work/data/workStore', () => ({
  requestWorkRefresh: vi.fn(),
}));

vi.mock('@/tools/design-canvas/store/designArtifactStore', () => ({
  useDesignArtifactStore: {
    getState: () => ({
      upsertManifest: vi.fn(),
      upsertManifests: vi.fn(),
    }),
  },
}));

vi.mock('@/tools/design-canvas/store/designTokensStore', () => ({
  useDesignTokensStore: {
    getState: () => ({
      upsert: vi.fn(),
    }),
  },
}));

describe('ToolEffectRegistry', () => {
  const originalWindow = globalThis.window;
  const originalCustomEvent = globalThis.CustomEvent;

  afterEach(() => {
    globalThis.window = originalWindow;
    globalThis.CustomEvent = originalCustomEvent;
    vi.restoreAllMocks();
  });

  it('dispatches RunBuilderPreview results for App Builder Workbench projection', async () => {
    globalThis.window = new EventTarget() as Window & typeof globalThis;
    if (typeof globalThis.CustomEvent === 'undefined') {
      globalThis.CustomEvent = class CustomEvent<T = unknown> extends Event {
        detail: T;

        constructor(type: string, eventInitDict?: CustomEventInit<T>) {
          super(type, eventInitDict);
          this.detail = eventInitDict?.detail as T;
        }
      } as typeof CustomEvent;
    }
    const { requestWorkRefresh } = await import('@/app/agentic-os/work/data/workStore');
    const { runCompletedToolEffects } = await import('./ToolEffectRegistry');
    const listener = vi.fn();
    window.addEventListener('app-builder-preview-result', listener);

    const result = {
      status: 'passed',
      kind: 'capability',
      previewResultId: 'preview:capability:runtime',
    };
    runCompletedToolEffects({
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolId: 'tool-1',
      toolName: 'RunBuilderPreview',
      result,
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toBeInstanceOf(CustomEvent);
    expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      result,
      toolName: 'RunBuilderPreview',
      turnId: 'turn-1',
    });
    expect(requestWorkRefresh).toHaveBeenCalledWith('builder-preview-completed');

    window.removeEventListener('app-builder-preview-result', listener);
  });
});
