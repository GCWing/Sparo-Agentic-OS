import React from 'react';
import {
  AppWindow,
  Blocks,
  BookOpen,
  Brain,
  FolderTree,
  LayoutDashboard,
  MailOpen,
  MessageSquareCode,
  Settings,
  SquareTerminal,
  Wrench,
} from 'lucide-react';
import type { WorkspaceSceneId } from '@/app/navigation/workspaceSceneTypes';
import type { WorkspaceSurface } from '@/app/navigation/workspaceSurfaceTypes';

type HubIcon = React.ElementType;

export type WorkspaceHubOpenTarget =
  | { kind: 'work-center' }
  | { kind: 'preview-only' }
  | { kind: 'scene'; sceneId: WorkspaceSceneId; systemScope?: boolean };

interface WorkspaceHubItemDefinition {
  id: string;
  group: 'frequent' | 'secondary' | 'utility';
  Icon: HubIcon;
  labelKey: string;
  openTarget: WorkspaceHubOpenTarget;
  matches: (surface: WorkspaceSurface) => boolean;
  preview: boolean;
}

export const WORKSPACE_HUB_ITEM_DEFINITIONS = [
  {
    id: 'work-center',
    group: 'frequent',
    Icon: LayoutDashboard,
    labelKey: 'scenes.workCenter',
    openTarget: { kind: 'work-center' },
    matches: (surface) => surface.kind === 'scene' && surface.sceneId === 'work-center',
    preview: true,
  },
  {
    id: 'apps',
    group: 'frequent',
    Icon: AppWindow,
    labelKey: 'nav.sections.apps',
    openTarget: { kind: 'scene', sceneId: 'apps' },
    matches: (surface) => surface.kind === 'scene'
      && (surface.sceneId === 'apps' || surface.sceneId.startsWith('app-surface:')),
    preview: true,
  },
  {
    id: 'files',
    group: 'frequent',
    Icon: FolderTree,
    labelKey: 'scenes.fileViewer',
    openTarget: { kind: 'scene', sceneId: 'file-viewer', systemScope: true },
    matches: (surface) => surface.kind === 'scene' && surface.sceneId === 'file-viewer',
    preview: true,
  },
  {
    id: 'shell',
    group: 'frequent',
    Icon: SquareTerminal,
    labelKey: 'nav.sections.shell',
    openTarget: { kind: 'scene', sceneId: 'shell', systemScope: true },
    matches: (surface) => surface.kind === 'scene' && surface.sceneId === 'shell',
    preview: true,
  },
  {
    id: 'daily-letter',
    group: 'secondary',
    Icon: MailOpen,
    labelKey: 'scenes.dailyLetter',
    openTarget: { kind: 'scene', sceneId: 'daily-letter' },
    matches: (surface) => surface.kind === 'scene' && surface.sceneId === 'daily-letter',
    preview: true,
  },
  {
    id: 'memory',
    group: 'secondary',
    Icon: Brain,
    labelKey: 'nav.items.memory',
    openTarget: { kind: 'scene', sceneId: 'memory' },
    matches: (surface) => surface.kind === 'scene' && surface.sceneId === 'memory',
    preview: true,
  },
  {
    id: 'skills',
    group: 'secondary',
    Icon: BookOpen,
    labelKey: 'nav.items.skills',
    openTarget: { kind: 'scene', sceneId: 'skills' },
    matches: (surface) => surface.kind === 'scene' && surface.sceneId === 'skills',
    preview: true,
  },
  {
    id: 'tools',
    group: 'secondary',
    Icon: Wrench,
    labelKey: 'nav.items.tools',
    openTarget: { kind: 'scene', sceneId: 'tools' },
    matches: (surface) => surface.kind === 'scene' && surface.sceneId === 'tools',
    preview: false,
  },
  {
    id: 'subagents',
    group: 'secondary',
    Icon: MessageSquareCode,
    labelKey: 'nav.items.subAgent',
    openTarget: { kind: 'scene', sceneId: 'subagents' },
    matches: (surface) => surface.kind === 'scene' && surface.sceneId === 'subagents',
    preview: false,
  },
  {
    id: 'capabilities',
    group: 'secondary',
    Icon: Blocks,
    labelKey: 'nav.items.capabilities',
    openTarget: { kind: 'preview-only' },
    matches: (surface) => surface.kind === 'scene'
      && (surface.sceneId === 'tools' || surface.sceneId === 'subagents'),
    preview: true,
  },
  {
    id: 'settings',
    group: 'utility',
    Icon: Settings,
    labelKey: 'tabs.settings',
    openTarget: { kind: 'scene', sceneId: 'settings' },
    matches: (surface) => surface.kind === 'scene' && surface.sceneId === 'settings',
    preview: false,
  },
] as const satisfies readonly WorkspaceHubItemDefinition[];

type WorkspaceHubItemDefinitionUnion = (typeof WORKSPACE_HUB_ITEM_DEFINITIONS)[number];
export type WorkspaceHubItemId = WorkspaceHubItemDefinitionUnion['id'];
export type WorkspaceHubFrequentItemId = Extract<
WorkspaceHubItemDefinitionUnion,
{ group: 'frequent' }
>['id'];
export type WorkspaceHubSecondaryItemId = Extract<
WorkspaceHubItemDefinitionUnion,
{ group: 'secondary' }
>['id'];
export type WorkspaceHubUtilityItemId = Extract<
WorkspaceHubItemDefinitionUnion,
{ group: 'utility' }
>['id'];
export type WorkspaceHubPreviewItemId = Extract<
WorkspaceHubItemDefinitionUnion,
{ preview: true }
>['id'];

export const WORKSPACE_HUB_FREQUENT_ITEM_IDS = WORKSPACE_HUB_ITEM_DEFINITIONS
  .filter((item): item is Extract<WorkspaceHubItemDefinitionUnion, { group: 'frequent' }> => (
    item.group === 'frequent'
  ))
  .map((item) => item.id);

export const WORKSPACE_HUB_SECONDARY_ITEM_IDS = WORKSPACE_HUB_ITEM_DEFINITIONS
  .filter((item): item is Extract<WorkspaceHubItemDefinitionUnion, { group: 'secondary' }> => (
    item.group === 'secondary'
  ))
  .map((item) => item.id);

const itemById = new Map<WorkspaceHubItemId, WorkspaceHubItemDefinitionUnion>(
  WORKSPACE_HUB_ITEM_DEFINITIONS.map((item) => [item.id, item]),
);

export function getWorkspaceHubItem(itemId: WorkspaceHubItemId): WorkspaceHubItemDefinitionUnion {
  return itemById.get(itemId) ?? WORKSPACE_HUB_ITEM_DEFINITIONS[0];
}

export function resolveWorkspaceHubItem(surface: WorkspaceSurface): WorkspaceHubItemId {
  return WORKSPACE_HUB_ITEM_DEFINITIONS.find((item) => item.matches(surface))?.id ?? 'work-center';
}

export function renderWorkspaceHubItemIcon(itemId: WorkspaceHubItemId, size = 15): React.ReactNode {
  const { Icon } = getWorkspaceHubItem(itemId);
  return <Icon size={size} />;
}

export function isWorkspaceHubPreviewItem(
  itemId: WorkspaceHubItemId,
): itemId is WorkspaceHubPreviewItemId {
  return getWorkspaceHubItem(itemId).preview;
}
