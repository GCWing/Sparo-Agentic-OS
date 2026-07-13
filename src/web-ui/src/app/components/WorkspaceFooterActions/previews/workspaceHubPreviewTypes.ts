import type React from 'react';
import type { NewWorkAgentChoice } from '@/app/components/WorkDock/NewWorkDialog';
import type { WorkspaceSceneId } from '@/app/navigation/workspaceSceneTypes';
import type { WorkspaceHubItemId } from '../workspaceHubItems';

export type {
  WorkspaceHubFrequentItemId,
  WorkspaceHubItemId,
  WorkspaceHubPreviewItemId,
  WorkspaceHubSecondaryItemId,
} from '../workspaceHubItems';

export interface WorkspaceHubPreviewProps {
  label: string;
  primaryActionRef: React.Ref<HTMLButtonElement>;
  onOpenItem: (itemId: WorkspaceHubItemId) => void;
  onOpenScene: (sceneId: WorkspaceSceneId) => void;
  onCreateWork: (initialAgentChoice?: NewWorkAgentChoice) => void;
  onClose: () => void;
}
