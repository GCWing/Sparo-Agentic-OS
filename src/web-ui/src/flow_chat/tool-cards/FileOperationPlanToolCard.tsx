import React, { useCallback, useMemo } from 'react';
import { ExternalLink, FolderCog } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { openWorkspaceScene } from '@/app/navigation/workspaceNavigation';
import type { FileOperationPlan } from '@/infrastructure/api';
import {
  dispatchFileWorkbenchPlanReview,
} from '@/tools/file-workbench';
import type { ToolCardProps } from '../types/flow-chat';
import { getToolViewState } from '../runtime/toolViewState';
import { DefaultToolCardTemplate } from './templates';
import { ToolErrorBlock } from './ToolErrorBlock';
import './FileOperationPlanToolCard.scss';

function isFileOperationPlan(value: unknown): value is FileOperationPlan {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as FileOperationPlan;
  return typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.cwd === 'string' &&
    Boolean(candidate.summary) &&
    Array.isArray(candidate.items);
}

function extractPlan(result: unknown): FileOperationPlan | null {
  if (isFileOperationPlan(result)) {
    return result;
  }

  if (result && typeof result === 'object' && 'plan' in result) {
    const plan = (result as { plan?: unknown }).plan;
    return isFileOperationPlan(plan) ? plan : null;
  }

  return null;
}

function basename(path: string | undefined): string {
  if (!path) return '';
  return path.split(/[/\\]/).filter(Boolean).pop() || path;
}

export const FileOperationPlanToolCard: React.FC<ToolCardProps> = ({
  toolItem,
  config,
}) => {
  const { t } = useTranslation('flow-chat');
  const { toolCall, toolResult, status } = toolItem;
  const toolId = toolItem.id ?? toolCall?.id;
  const viewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
  const plan = useMemo(() => extractPlan(toolResult?.result), [toolResult?.result]);
  const hasError = viewState.phase === 'error' || toolResult?.success === false;

  const handleReviewInFiles = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    if (!plan) {
      return;
    }

    openWorkspaceScene('file-viewer', {
      workspacePath: plan.scope.kind === 'workspace' ? plan.scope.root : null,
    });
    dispatchFileWorkbenchPlanReview({ plan, source: 'tool-card' });
  }, [plan]);

  const subject = useMemo(() => {
    if (hasError) {
      return t('toolCards.fileOperationPlan.failed');
    }

    if (!plan) {
      return viewState.isLive
        ? t('toolCards.fileOperationPlan.planning')
        : t('toolCards.fileOperationPlan.unavailable');
    }

    return t('toolCards.fileOperationPlan.summary', {
      title: plan.title,
      count: plan.summary.total,
    });
  }, [hasError, plan, t, viewState.isLive]);

  const expandedContent = hasError ? (
    <ToolErrorBlock
      title={t('toolCards.fileOperationPlan.failed')}
      message={toolResult?.error ?? t('toolCards.default.failed')}
    />
  ) : plan ? (
    <div className="file-operation-plan-card__body" data-testid="file-operation-plan-tool-card">
      <div className="file-operation-plan-card__meta">
        <span>{t('toolCards.fileOperationPlan.highRisk', { count: plan.summary.highRiskCount })}</span>
        <span>{t('toolCards.fileOperationPlan.conflicts', { count: plan.summary.conflictCount })}</span>
        <span>{plan.cwd}</span>
      </div>
      <ol className="file-operation-plan-card__items">
        {plan.items.slice(0, 4).map((item) => (
          <li key={item.id}>
            <span>{item.operationType}</span>
            <strong>{basename(item.sourcePath ?? item.targetPath)}</strong>
          </li>
        ))}
      </ol>
      {plan.items.length > 4 && (
        <div className="file-operation-plan-card__more">
          {t('toolCards.fileOperationPlan.moreItems', { count: plan.items.length - 4 })}
        </div>
      )}
    </div>
  ) : undefined;

  return (
    <DefaultToolCardTemplate
      toolId={toolId}
      toolName={config.toolName}
      status={status}
      statusIcon={<FolderCog size={14} />}
      action={t('toolCards.fileOperationPlan.action')}
      summary={subject}
      expandable={Boolean(plan) || hasError}
      expandedContent={expandedContent}
      isExpanded={Boolean(plan) || hasError}
      className="file-operation-plan-card"
      primaryAction={plan ? {
        icon: <ExternalLink size={12} />,
        label: t('toolCards.fileOperationPlan.reviewInFiles'),
        onClick: handleReviewInFiles,
        className: 'file-operation-plan-card__review',
      } : undefined}
    />
  );
};
