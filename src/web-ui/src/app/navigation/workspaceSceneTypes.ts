import type { LucideIcon } from 'lucide-react';

export type WorkspaceSceneId =
  | 'terminal'
  | 'settings'
  | 'file-viewer'
  | 'memory'
  | 'apps'
  | 'subagents'
  | 'skills'
  | 'tools'
  | 'shell'
  | 'panel-view'
  | 'work-center'
  | `live-app:${string}`;

export type SceneId = 'session' | WorkspaceSceneId;

export type SceneTabId = SceneId;

export interface WorkspaceSceneDef {
  id: WorkspaceSceneId;
  label: string;
  labelKey?: string;
  Icon?: LucideIcon;
}
