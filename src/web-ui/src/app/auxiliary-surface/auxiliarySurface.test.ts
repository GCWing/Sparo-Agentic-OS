import { beforeEach, describe, expect, it } from 'vitest';
import {
  activateAgentCanvasHost,
  removeAgentCanvasHost,
  useAgentCanvasStore,
} from '@/app/components/panels/content-canvas/stores';
import { createAgenticOsHomeSurface } from '@/app/navigation/workspaceSurfaceTypes';
import { useWorkspaceSurfaceStore } from '@/app/navigation/workspaceSurfaceStore';
import { useAuxiliarySurfaceStore } from './auxiliarySurfaceStore';
import {
  enterActiveAuxiliarySceneFocus,
  exitActiveAuxiliarySceneFocus,
  openActiveAuxiliaryItemAtPresentation,
  openAuxiliaryItem,
  registerAuxiliarySurfaceRestorer,
  toggleActiveAuxiliarySurface,
} from './controller';
import { homeAuxiliaryHostKey, sessionAuxiliaryHostKey } from './host';

const sessionAHost = sessionAuxiliaryHostKey('session-a');
const sessionBHost = sessionAuxiliaryHostKey('session-b');
const homeHost = homeAuxiliaryHostKey('os-home');
const testHosts = [sessionAHost, sessionBHost, homeHost] as const;

function visibleTabTitles(): string[] {
  return useAgentCanvasStore.getState().getAllTabs()
    .filter(tab => tab.isHidden !== true)
    .map(tab => tab.title);
}

function resetState(): void {
  testHosts.forEach(removeAgentCanvasHost);
  activateAgentCanvasHost(null);
  useAgentCanvasStore.getState().reset();
  useAuxiliarySurfaceStore.setState({
    activeHostKey: null,
    hosts: {},
  });
  useWorkspaceSurfaceStore.setState({
    activeSurface: createAgenticOsHomeSurface(),
    previousSurface: null,
    currentOsSessionId: null,
    sceneHistory: [],
    surfaceContext: null,
  });
}

describe('auxiliary surface lifecycle', () => {
  beforeEach(resetState);

  it('does not carry a session workbench into Home when returning', () => {
    useWorkspaceSurfaceStore.getState().openSurface({
      kind: 'session',
      sessionId: 'session-a',
    });
    openAuxiliaryItem({
      hostKey: sessionAHost,
      item: {
        type: 'product-app-runtime',
        title: 'Product App',
        duplicateCheckKey: 'product-app:session-a',
      },
    });

    expect(visibleTabTitles()).toEqual(['Product App']);
    expect(useAuxiliarySurfaceStore.getState().hosts[sessionAHost]?.presentation)
      .toBe('docked');

    useWorkspaceSurfaceStore.getState().returnHome('os-home');

    expect(useAuxiliarySurfaceStore.getState().activeHostKey).toBe(homeHost);
    expect(visibleTabTitles()).toEqual([]);
    expect(useAuxiliarySurfaceStore.getState().hosts[homeHost]?.presentation)
      .toBe('closed');

    useWorkspaceSurfaceStore.getState().openSurface({
      kind: 'session',
      sessionId: 'session-a',
    });

    expect(visibleTabTitles()).toEqual(['Product App']);
    expect(useAuxiliarySurfaceStore.getState().hosts[sessionAHost]?.presentation)
      .toBe('docked');
  });

  it('queues background-host items without changing the active surface', () => {
    useWorkspaceSurfaceStore.getState().openSurface({
      kind: 'session',
      sessionId: 'session-a',
    });
    openAuxiliaryItem({
      hostKey: sessionBHost,
      item: {
        type: 'code-editor',
        title: 'Background file',
        duplicateCheckKey: 'file:b',
      },
    });

    expect(visibleTabTitles()).toEqual([]);
    expect(useAuxiliarySurfaceStore.getState().hosts[sessionAHost]?.presentation)
      .toBe('closed');

    useWorkspaceSurfaceStore.getState().openSurface({
      kind: 'session',
      sessionId: 'session-b',
    });

    expect(visibleTabTitles()).toEqual(['Background file']);
    expect(useAuxiliarySurfaceStore.getState().hosts[sessionBHost]?.presentation)
      .toBe('docked');
  });

  it('keeps a user-closed host closed when profile policy reconciles again', () => {
    useWorkspaceSurfaceStore.getState().openSurface({
      kind: 'session',
      sessionId: 'session-a',
    });
    const store = useAuxiliarySurfaceStore.getState();
    store.configureHost(sessionAHost, 'product-app-runtime', 'visible');
    openAuxiliaryItem({
      hostKey: sessionAHost,
      item: {
        type: 'product-app-runtime',
        title: 'Product App',
        duplicateCheckKey: 'product-app:session-a',
      },
      reveal: 'policy',
    });
    store.reconcileItems(sessionAHost, 1);
    expect(useAuxiliarySurfaceStore.getState().hosts[sessionAHost]?.presentation)
      .toBe('docked');

    useAuxiliarySurfaceStore.getState().collapse(sessionAHost, 'user');
    useWorkspaceSurfaceStore.getState().openSurface({
      kind: 'session',
      sessionId: 'session-b',
    });
    useWorkspaceSurfaceStore.getState().openSurface({
      kind: 'session',
      sessionId: 'session-a',
    });
    useAuxiliarySurfaceStore.getState().configureHost(
      sessionAHost,
      'product-app-runtime',
      'visible',
    );
    useAuxiliarySurfaceStore.getState().reconcileItems(sessionAHost, 1);

    expect(useAuxiliarySurfaceStore.getState().hosts[sessionAHost]).toMatchObject({
      presentation: 'closed',
      userDisposition: 'closed',
    });
  });

  it('collapses and expands without destroying the current tabs', () => {
    useWorkspaceSurfaceStore.getState().openSurface({
      kind: 'session',
      sessionId: 'session-a',
    });
    openAuxiliaryItem({
      hostKey: sessionAHost,
      item: {
        type: 'product-app-runtime',
        title: 'Product App',
        duplicateCheckKey: 'product-app:session-a',
      },
    });

    useAuxiliarySurfaceStore.getState().collapse(sessionAHost, 'user');
    expect(visibleTabTitles()).toEqual(['Product App']);
    expect(useAuxiliarySurfaceStore.getState().hosts[sessionAHost]?.presentation)
      .toBe('closed');

    toggleActiveAuxiliarySurface();

    expect(visibleTabTitles()).toEqual(['Product App']);
    expect(useAuxiliarySurfaceStore.getState().hosts[sessionAHost]?.presentation)
      .toBe('docked');
  });

  it('restores the profile default after the final tab is closed', () => {
    useWorkspaceSurfaceStore.getState().openSurface({
      kind: 'session',
      sessionId: 'session-a',
    });
    openAuxiliaryItem({
      hostKey: sessionAHost,
      item: {
        type: 'product-app-runtime',
        title: 'Old Product App',
        duplicateCheckKey: 'product-app:session-a',
      },
    });
    const openTab = useAgentCanvasStore.getState().primaryGroup.tabs[0];
    useAgentCanvasStore.getState().closeTab(openTab.id, 'primary');
    useAuxiliarySurfaceStore.getState().collapse(sessionAHost, 'empty');

    const unregister = registerAuxiliarySurfaceRestorer(sessionAHost, () => {
      openAuxiliaryItem({
        hostKey: sessionAHost,
        item: {
          type: 'product-app-runtime',
          title: 'Current Product App',
          duplicateCheckKey: 'product-app:session-a',
        },
        reveal: 'preserve',
      });
    });

    try {
      toggleActiveAuxiliarySurface();

      expect(visibleTabTitles()).toEqual(['Current Product App']);
      expect(useAuxiliarySurfaceStore.getState().hosts[sessionAHost]?.presentation)
        .toBe('docked');
    } finally {
      unregister();
    }
  });

  it('falls back to the most recently closed tab when no profile default exists', () => {
    useWorkspaceSurfaceStore.getState().openSurface({
      kind: 'session',
      sessionId: 'session-a',
    });
    openAuxiliaryItem({
      hostKey: sessionAHost,
      item: {
        type: 'code-editor',
        title: 'Recently closed file',
        duplicateCheckKey: 'file:recent',
      },
    });
    const openTab = useAgentCanvasStore.getState().primaryGroup.tabs[0];
    useAgentCanvasStore.getState().closeTab(openTab.id, 'primary');
    useAuxiliarySurfaceStore.getState().collapse(sessionAHost, 'empty');

    toggleActiveAuxiliarySurface();

    expect(visibleTabTitles()).toEqual(['Recently closed file']);
    expect(useAuxiliarySurfaceStore.getState().hosts[sessionAHost]?.presentation)
      .toBe('docked');
  });

  it('returns scene focus to the presentation that launched it', () => {
    useWorkspaceSurfaceStore.getState().openSurface({
      kind: 'session',
      sessionId: 'session-a',
    });
    openAuxiliaryItem({
      hostKey: sessionAHost,
      item: {
        type: 'markdown-editor',
        title: 'Composer context',
        duplicateCheckKey: 'composer-context:test',
      },
    });
    useAuxiliarySurfaceStore.getState().collapse(sessionAHost, 'user');

    expect(enterActiveAuxiliarySceneFocus()).toBe(true);
    expect(useAuxiliarySurfaceStore.getState().hosts[sessionAHost]?.presentation)
      .toBe('scene-focus');
    expect(exitActiveAuxiliarySceneFocus('previous')).toBe(true);
    expect(useAuxiliarySurfaceStore.getState().hosts[sessionAHost]?.presentation)
      .toBe('closed');

    useAuxiliarySurfaceStore.getState().reveal(sessionAHost, 'user');
    enterActiveAuxiliarySceneFocus();
    exitActiveAuxiliarySceneFocus('previous');
    expect(useAuxiliarySurfaceStore.getState().hosts[sessionAHost]?.presentation)
      .toBe('docked');
  });

  it('opens scene focus inside the current session surface without independent navigation', () => {
    useWorkspaceSurfaceStore.getState().openSurface({
      kind: 'session',
      sessionId: 'session-a',
    });
    const activeSurfaceBefore = useWorkspaceSurfaceStore.getState().activeSurface;
    const sceneHistoryBefore = useWorkspaceSurfaceStore.getState().sceneHistory;

    expect(openActiveAuxiliaryItemAtPresentation({
      type: 'markdown-editor',
      title: 'Composer context',
      duplicateCheckKey: 'composer-context:inside-session',
    }, 'scene-focus')).toBe(true);

    expect(useWorkspaceSurfaceStore.getState().activeSurface).toEqual(activeSurfaceBefore);
    expect(useWorkspaceSurfaceStore.getState().sceneHistory).toEqual(sceneHistoryBefore);
    expect(useAuxiliarySurfaceStore.getState().activeHostKey).toBe(sessionAHost);
    expect(useAuxiliarySurfaceStore.getState().hosts[sessionAHost]?.presentation)
      .toBe('scene-focus');
    expect(visibleTabTitles()).toEqual(['Composer context']);
  });
});
