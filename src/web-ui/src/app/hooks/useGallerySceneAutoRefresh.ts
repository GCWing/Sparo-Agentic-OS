import { useEffect, useRef } from 'react';
import type { WorkspaceSceneId } from '@/app/navigation/workspaceSceneTypes';
import { useWorkspaceSurfaceStore } from '@/app/navigation/workspaceSurfaceStore';

export interface UseGallerySceneAutoRefreshOptions {
  /** Workspace scene id (e.g. 'skills', 'agents', 'apps'). */
  sceneId: WorkspaceSceneId;
  /** Reload lists; may be async. */
  refetch: () => void | Promise<void>;
  enabled?: boolean;
}

/**
 * Gallery scenes are unmounted when their workspace surface is not active.
 * This hook refreshes data when:
 * 1. The scene surface becomes active (user navigates to it).
 * 2. The window regains visibility while this scene is active.
 *
 * Initial load remains the responsibility of each feature hook.
 */
export function useGallerySceneAutoRefresh({
  sceneId,
  refetch,
  enabled = true,
}: UseGallerySceneAutoRefreshOptions): void {
  const activeSurface = useWorkspaceSurfaceStore(s => s.activeSurface);
  const isActive = activeSurface.kind === 'scene' && activeSurface.sceneId === sceneId;
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  const wasActiveRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (wasActiveRef.current === null) {
      wasActiveRef.current = isActive;
      return;
    }
    if (isActive && !wasActiveRef.current) {
      void Promise.resolve(refetchRef.current());
    }
    wasActiveRef.current = isActive;
  }, [enabled, isActive]);

  useEffect(() => {
    if (!enabled) return;
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const current = useWorkspaceSurfaceStore.getState().activeSurface;
      if (current.kind !== 'scene' || current.sceneId !== sceneId) return;
      void Promise.resolve(refetchRef.current());
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [enabled, activeSurface, sceneId]);
}
