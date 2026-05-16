import { lazy } from 'react';
import type { ComponentType } from 'react';
import type { WorkspaceSceneId } from '../navigation/workspaceSceneTypes';

type LazyNavComponent = ReturnType<typeof lazy<ComponentType>>;

const SCENE_NAV_REGISTRY: Partial<Record<WorkspaceSceneId, LazyNavComponent>> = {
  'file-viewer': lazy(() => import('./file-viewer/FileViewerNav')),
};

export function getSceneNav(sceneId: WorkspaceSceneId): LazyNavComponent | null {
  return SCENE_NAV_REGISTRY[sceneId] ?? null;
}
