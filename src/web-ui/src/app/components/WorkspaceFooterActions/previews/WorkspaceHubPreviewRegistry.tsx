import React, { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import {
  WorkspaceHubPreviewFrame,
  WorkspaceHubPreviewLoading,
} from './WorkspaceHubPreviewFrame';
import type {
  WorkspaceHubPreviewItemId,
  WorkspaceHubPreviewProps,
} from './workspaceHubPreviewTypes';
import './WorkspaceHubPreviewFrame.scss';

const PREVIEW_REGISTRY: Record<
WorkspaceHubPreviewItemId,
LazyExoticComponent<ComponentType<WorkspaceHubPreviewProps>>
> = {
  'work-center': lazy(() => import('./WorkCenterPreview')),
  apps: lazy(() => import('./AppsPreview')),
  files: lazy(() => import('./FilesPreview')),
  shell: lazy(() => import('./ShellPreview')),
  'daily-letter': lazy(() => import('./DailyLetterPreview')),
  memory: lazy(() => import('./MemoryPreview')),
  skills: lazy(() => import('./SkillsPreview')),
  capabilities: lazy(() => import('./CapabilitiesPreview')),
};

interface WorkspaceHubPreviewRegistryProps extends WorkspaceHubPreviewProps {
  itemId: WorkspaceHubPreviewItemId;
}

function getCategoryKey(itemId: WorkspaceHubPreviewItemId): string {
  return itemId === 'work-center'
    ? 'nav.menuPanel.hub.items.workCenter.category'
    : `nav.menuPanel.hub.items.${itemId}.category`;
}

export const WorkspaceHubPreview: React.FC<WorkspaceHubPreviewRegistryProps> = ({
  itemId,
  ...previewProps
}) => {
  const { t } = useI18n('common');
  const Preview = PREVIEW_REGISTRY[itemId];

  return (
    <Suspense
      fallback={(
        <WorkspaceHubPreviewFrame
          category={t(getCategoryKey(itemId))}
          title={previewProps.label}
          status={t('nav.menuPanel.hub.preview.common.loading')}
          statusTone="neutral"
          actions={<span />}
        >
          <WorkspaceHubPreviewLoading rows={3} />
        </WorkspaceHubPreviewFrame>
      )}
    >
      <Preview {...previewProps} />
    </Suspense>
  );
};
