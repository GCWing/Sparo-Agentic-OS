import { beforeEach, describe, expect, it } from 'vitest';
import {
  activateAgentCanvasHost,
  removeAgentCanvasHost,
  useAgentCanvasStore,
} from '@/app/components/panels/content-canvas/stores';
import { createAgenticOsHomeSurface } from '@/app/navigation/workspaceSurfaceTypes';
import { useWorkspaceSurfaceStore } from '@/app/navigation/workspaceSurfaceStore';
import { useAuxiliarySurfaceStore } from './auxiliarySurfaceStore';
import { openAuxiliaryItem } from './controller';
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
});
