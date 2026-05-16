import { openWorkspaceHome, openWorkspaceScene } from '../navigation/workspaceNavigation';
import { useWorkspaceSurfaceStore } from '../navigation/workspaceSurfaceStore';
import type { WorkspaceSceneId } from '../navigation/workspaceSceneTypes';

export interface UseSceneManagerReturn {
  activeTabId: string;
  openScene: (id: string) => void;
  closeScene: (id: string) => void;
  activateScene: (id: string) => void;
}

export function useSceneManager(): UseSceneManagerReturn {
  const activeSurface = useWorkspaceSurfaceStore((s) => s.activeSurface);
  const activeTabId = activeSurface.kind === 'scene' ? activeSurface.sceneId : 'session';

  const openScene = (id: string) => {
    if (id === 'session' || id === 'welcome') {
      void openWorkspaceHome();
      return;
    }
    openWorkspaceScene(id as WorkspaceSceneId);
  };

  return {
    activeTabId,
    openScene,
    closeScene: (id) => {
      if (activeSurface.kind === 'scene' && activeSurface.sceneId === id) {
        void openWorkspaceHome();
      }
    },
    activateScene: openScene,
  };
}
