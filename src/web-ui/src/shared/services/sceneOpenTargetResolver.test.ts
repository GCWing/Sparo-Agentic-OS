import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceSurfaceStore } from '@/app/navigation/workspaceSurfaceStore';
import type { WorkspaceSurface } from '@/app/navigation/workspaceSurfaceTypes';
import {
  externalRuntimeScope,
  projectRuntimeScopeFromWorkspacePath,
  systemRuntimeScope,
} from '@/shared/types/runtime-scope';
import { resolveAndFocusOpenTarget } from './sceneOpenTargetResolver';

const openWorkspaceSceneMock = vi.hoisted(() => vi.fn());

vi.mock('@/app/navigation/workspaceNavigation', () => ({
  openWorkspaceScene: openWorkspaceSceneMock,
}));

const homeSurface: WorkspaceSurface = {
  kind: 'agentic-os-home',
  agenticOsSessionId: null,
  scope: systemRuntimeScope(),
};

function resetStore() {
  openWorkspaceSceneMock.mockReset();
  useWorkspaceSurfaceStore.setState({
    activeSurface: homeSurface,
    previousSurface: null,
    sceneHistory: [],
    surfaceContext: null,
    focusedSessionId: null,
    composerTargetSessionId: null,
  });
}

describe('sceneOpenTargetResolver', () => {
  beforeEach(() => {
    resetStore();
  });

  it('uses explicit runtime scope when focusing the file viewer', () => {
    const scope = externalRuntimeScope('D:/runtime/artifacts')!;
    useWorkspaceSurfaceStore.getState().openSurface({
      kind: 'scene',
      sceneId: 'apps',
      scope: systemRuntimeScope(),
    });

    const resolution = resolveAndFocusOpenTarget('file', {
      source: 'project-nav',
      scope,
    });

    expect(resolution.mode).toBe('project');
    expect(resolution.targetSceneId).toBe('file-viewer');
    expect(resolution.sceneJustOpened).toBe(true);
    expect(openWorkspaceSceneMock).toHaveBeenCalledWith('file-viewer', { scope });
  });

  it('treats a file-viewer scope change as a freshly mounted target', () => {
    const currentScope = projectRuntimeScopeFromWorkspacePath('D:/workspace/project')!;
    const targetScope = externalRuntimeScope('D:/runtime/artifacts')!;
    useWorkspaceSurfaceStore.getState().openSurface({
      kind: 'scene',
      sceneId: 'file-viewer',
      scope: currentScope,
    });

    const resolution = resolveAndFocusOpenTarget('file', {
      source: 'project-nav',
      scope: targetScope,
    });

    expect(resolution.mode).toBe('project');
    expect(resolution.targetSceneId).toBe('file-viewer');
    expect(resolution.sceneJustOpened).toBe(true);
    expect(openWorkspaceSceneMock).toHaveBeenCalledWith('file-viewer', { scope: targetScope });
  });
});
