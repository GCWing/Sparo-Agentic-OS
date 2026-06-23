import { beforeEach, describe, expect, it } from 'vitest';
import {
  selectCanGoBackScene,
  useWorkspaceSurfaceStore,
  WORKSPACE_SCENE_HISTORY_LIMIT,
} from './workspaceSurfaceStore';
import type { WorkspaceSurface } from './workspaceSurfaceTypes';

const homeSurface: WorkspaceSurface = { kind: 'agentic-os-home', agenticOsSessionId: null };

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

    store.openSurface({ kind: 'scene', sceneId: 'apps' });
    store.openSurface({ kind: 'scene', sceneId: 'settings' });
    expect(historyKeys()).toEqual(['apps']);

    store.openSurface({ kind: 'agentic-os-home', agenticOsSessionId: 'agentic-home-1' });
    expect(useWorkspaceSurfaceStore.getState().sceneHistory).toEqual([]);
    expect(useWorkspaceSurfaceStore.getState().goBackScene()).toBe(false);
    expect(selectCanGoBackScene(useWorkspaceSurfaceStore.getState())).toBe(false);
  });

  it('keeps Agentic OS home out of scene history', () => {
    const store = useWorkspaceSurfaceStore.getState();

    useWorkspaceSurfaceStore.setState({
      activeSurface: { kind: 'agentic-os-home', agenticOsSessionId: 'agentic-home-1' },
      sceneHistory: [{
        surface: { kind: 'scene', sceneId: 'apps' },
        context: null,
        visitedAt: 1,
      }],
    });
    expect(useWorkspaceSurfaceStore.getState().goBackScene()).toBe(false);
    store.openSurface({ kind: 'agentic-os-home', agenticOsSessionId: 'agentic-home-1' });
    expect(useWorkspaceSurfaceStore.getState().sceneHistory).toEqual([]);
    expect(selectCanGoBackScene(useWorkspaceSurfaceStore.getState())).toBe(false);
  });

  it('records session surfaces in scene history', () => {
    const store = useWorkspaceSurfaceStore.getState();

    store.openSurface({ kind: 'session', sessionId: 'session-1' });
    expect(historyKeys()).toEqual([]);

    store.openSurface({ kind: 'scene', sceneId: 'file-viewer' });
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

    store.openSurface({ kind: 'scene', sceneId: 'apps' });
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
      store.openSurface({ kind: 'scene', sceneId });
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

    store.openSurface({ kind: 'scene', sceneId: 'apps' });
    store.openSurface({ kind: 'scene', sceneId: 'settings' });
    store.openSurface({ kind: 'scene', sceneId: 'memory' });

    expect(historyKeys()).toEqual(['settings', 'apps']);

    expect(useWorkspaceSurfaceStore.getState().openSceneHistoryEntry(1)).toBe(true);
    expect(useWorkspaceSurfaceStore.getState().activeSurface).toEqual({
      kind: 'scene',
      sceneId: 'apps',
    });
    expect(historyKeys()).toEqual(['settings']);
  });
});
