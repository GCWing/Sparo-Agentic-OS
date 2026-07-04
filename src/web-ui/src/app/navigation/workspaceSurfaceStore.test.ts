import { beforeEach, describe, expect, it } from 'vitest';
import {
  selectCanGoBackScene,
  useWorkspaceSurfaceStore,
  WORKSPACE_SCENE_HISTORY_LIMIT,
} from './workspaceSurfaceStore';
import type { WorkspaceSceneId } from './workspaceSceneTypes';
import { isSameWorkspaceSurface, type WorkspaceSurface } from './workspaceSurfaceTypes';
import { systemRuntimeScope } from '@/shared/types/runtime-scope';
import type { ProductAppRuntimeContext } from '@/shared/types/product-app-runtime';

const homeSurface: WorkspaceSurface = {
  kind: 'agentic-os-home',
  agenticOsSessionId: null,
  scope: systemRuntimeScope(),
};

function sceneSurface(sceneId: WorkspaceSceneId): Extract<WorkspaceSurface, { kind: 'scene' }> {
  return {
    kind: 'scene',
    sceneId,
    scope: systemRuntimeScope(),
  };
}

function runtimeContext(runtimeInstanceId: string, workId = 'work-1'): ProductAppRuntimeContext {
  return {
    workId,
    runtimeInstanceId,
    productAppId: 'product-app-1',
    productAppVersion: '1.0.0',
    componentLockDigest: 'lock-digest-1',
    productAppSurfaceId: 'product-app-surface-1',
    surfaceId: 'main',
    hostSurfaceId: 'host-product-app-surface-1',
  };
}

function historyKeys(): string[] {
  return useWorkspaceSurfaceStore.getState().sceneHistory.map((entry) => (
    entry.surface.kind === 'scene'
      ? entry.surface.sceneId
      : `session:${entry.surface.sessionId}`
  ));
}

function resetStore() {
  useWorkspaceSurfaceStore.setState({
    activeSurface: homeSurface,
    previousSurface: null,
    sceneHistory: [],
    surfaceContext: null,
    focusedSessionId: null,
    composerTargetSessionId: null,
  });
}

describe('workspaceSurfaceStore scene history', () => {
  beforeEach(() => {
    resetStore();
  });

  it('clears scene history when returning to Agentic OS home', () => {
    const store = useWorkspaceSurfaceStore.getState();

    store.openSurface(sceneSurface('apps'));
    store.openSurface(sceneSurface('settings'));
    expect(historyKeys()).toEqual(['apps']);

    store.openSurface({ kind: 'agentic-os-home', agenticOsSessionId: 'agentic-home-1', scope: systemRuntimeScope() });
    expect(useWorkspaceSurfaceStore.getState().sceneHistory).toEqual([]);
    expect(useWorkspaceSurfaceStore.getState().goBackScene()).toBe(false);
    expect(selectCanGoBackScene(useWorkspaceSurfaceStore.getState())).toBe(false);
  });

  it('keeps Agentic OS home out of scene history', () => {
    const store = useWorkspaceSurfaceStore.getState();

    useWorkspaceSurfaceStore.setState({
      activeSurface: { kind: 'agentic-os-home', agenticOsSessionId: 'agentic-home-1', scope: systemRuntimeScope() },
      sceneHistory: [{
        surface: sceneSurface('apps') as Exclude<WorkspaceSurface, { kind: 'agentic-os-home' }>,
        context: null,
        visitedAt: 1,
      }],
    });
    expect(useWorkspaceSurfaceStore.getState().goBackScene()).toBe(false);
    store.openSurface({ kind: 'agentic-os-home', agenticOsSessionId: 'agentic-home-1', scope: systemRuntimeScope() });
    expect(useWorkspaceSurfaceStore.getState().sceneHistory).toEqual([]);
    expect(selectCanGoBackScene(useWorkspaceSurfaceStore.getState())).toBe(false);
  });

  it('records session surfaces in scene history', () => {
    const store = useWorkspaceSurfaceStore.getState();

    store.openSurface({ kind: 'session', sessionId: 'session-1' });
    expect(historyKeys()).toEqual([]);

    store.openSurface(sceneSurface('file-viewer'));
    expect(historyKeys()).toEqual(['session:session-1']);

    expect(useWorkspaceSurfaceStore.getState().goBackScene()).toBe(true);
    expect(useWorkspaceSurfaceStore.getState().activeSurface).toEqual({
      kind: 'session',
      sessionId: 'session-1',
    });
    expect(useWorkspaceSurfaceStore.getState().focusedSessionId).toBe('session-1');
    expect(useWorkspaceSurfaceStore.getState().composerTargetSessionId).toBe('session-1');
    expect(historyKeys()).toEqual([]);
  });

  it('records scene surfaces when entering a session surface', () => {
    const store = useWorkspaceSurfaceStore.getState();

    store.openSurface(sceneSurface('apps'));
    store.openSurface({ kind: 'session', sessionId: 'session-1' });

    expect(historyKeys()).toEqual(['apps']);
  });

  it('bounds scene history and de-duplicates scene surfaces', () => {
    const store = useWorkspaceSurfaceStore.getState();
    const sceneIds = [
      'apps',
      'settings',
      'file-viewer',
      'memory',
      'tools',
      'skills',
      'apps',
    ] as const;

    for (const sceneId of sceneIds) {
      store.openSurface(sceneSurface(sceneId));
    }

    const history = useWorkspaceSurfaceStore.getState().sceneHistory;
    expect(history).toHaveLength(WORKSPACE_SCENE_HISTORY_LIMIT);
    expect(historyKeys()).toEqual([
      'skills',
      'tools',
      'memory',
      'file-viewer',
      'settings',
    ]);
  });

  it('restores a selected history entry without pushing the current scene', () => {
    const store = useWorkspaceSurfaceStore.getState();

    store.openSurface(sceneSurface('apps'));
    store.openSurface(sceneSurface('settings'));
    store.openSurface(sceneSurface('memory'));

    expect(historyKeys()).toEqual(['settings', 'apps']);

    expect(useWorkspaceSurfaceStore.getState().openSceneHistoryEntry(1)).toBe(true);
    expect(useWorkspaceSurfaceStore.getState().activeSurface).toEqual({
      kind: 'scene',
      sceneId: 'apps',
      scope: systemRuntimeScope(),
    });
    expect(historyKeys()).toEqual(['settings']);
  });

  it('keeps product app runtime instances as distinct scene surfaces', () => {
    const first = {
      ...sceneSurface('app-surface:host-product-app-surface-1'),
      runtimeContext: runtimeContext('runtime-1'),
    };
    const second = {
      ...sceneSurface('app-surface:host-product-app-surface-1'),
      runtimeContext: runtimeContext('runtime-2'),
    };

    expect(isSameWorkspaceSurface(first, second)).toBe(false);
  });
});
