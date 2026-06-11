import {
  Terminal,
  Settings,
  FolderTree,
  Brain,
  Users,
  Puzzle,
  Wrench,
  ExternalLink,
  LayoutDashboard,
} from 'lucide-react';
import { SparoSubagentIcon } from '@/design-system';
import type { WorkspaceSceneDef, WorkspaceSceneId } from './workspaceSceneTypes';

export const WORKSPACE_SCENE_REGISTRY: WorkspaceSceneDef[] = [
  {
    id: 'terminal',
    label: 'Terminal',
    labelKey: 'scenes.terminal',
    Icon: Terminal,
  },
  {
    id: 'settings',
    label: 'Settings',
    labelKey: 'scenes.settings',
    Icon: Settings,
  },
  {
    id: 'file-viewer',
    label: 'Files',
    labelKey: 'scenes.fileViewer',
    Icon: FolderTree,
  },
  {
    id: 'memory',
    label: 'Memory',
    labelKey: 'scenes.memory',
    Icon: Brain,
  },
  {
    id: 'apps',
    label: 'Apps',
    labelKey: 'scenes.apps',
    Icon: Users,
  },
  {
    id: 'subagents',
    label: 'Subagents',
    labelKey: 'scenes.subagents',
    Icon: SparoSubagentIcon,
  },
  {
    id: 'skills',
    label: 'Skills',
    labelKey: 'scenes.skills',
    Icon: Puzzle,
  },
  {
    id: 'tools',
    label: 'Tools',
    labelKey: 'scenes.tools',
    Icon: Wrench,
  },
  {
    id: 'shell',
    label: 'Shell',
    labelKey: 'scenes.shell',
    Icon: Terminal,
  },
  {
    id: 'panel-view',
    label: 'Panel View',
    labelKey: 'scenes.panelView',
    Icon: ExternalLink,
  },
  {
    id: 'work-center',
    label: 'Work Center',
    labelKey: 'scenes.workCenter',
    Icon: LayoutDashboard,
  },
];

export function getWorkspaceSceneDef(id: WorkspaceSceneId): WorkspaceSceneDef | undefined {
  if (typeof id === 'string' && id.startsWith('live-app:')) {
    const appId = id.slice('live-app:'.length);
    return { id, label: appId, Icon: Puzzle };
  }
  return WORKSPACE_SCENE_REGISTRY.find(d => d.id === id);
}
