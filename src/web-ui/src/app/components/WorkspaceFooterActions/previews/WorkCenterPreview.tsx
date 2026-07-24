import React, { useCallback, useMemo } from 'react';
import {
  Activity,
  ArrowRight,
  CircleAlert,
  CirclePlus,
  LayoutDashboard,
} from 'lucide-react';
import { Button, IconButton } from '@/design-system';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import { useWorks } from '@/app/agentic-os/work/hooks/useWorks';
import {
  isDockEligibleWork,
  isWorkAttentionStatus,
  isWorkRunningStatus,
} from '@/app/agentic-os/work/domain/workClassification';
import type { WorkStatus } from '@/app/agentic-os/work/domain/workTypes';
import type { WorkProjection } from '@/app/agentic-os/work/projections/workProjection';
import { WorkIcon } from '@/app/agentic-os/work/presentation/WorkIcon';
import { openWork } from '@/app/agentic-os/work/navigation/openWork';
import {
  compareWorksForDock,
  getWorkToneValue,
} from '@/app/components/WorkList/workListSelection';
import { createLogger } from '@/shared/utils/logger';
import {
  WorkspaceHubPreviewEmpty,
  WorkspaceHubPreviewError,
  WorkspaceHubPreviewFrame,
  WorkspaceHubPreviewLoading,
  type WorkspaceHubPreviewTone,
} from './WorkspaceHubPreviewFrame';
import type { WorkspaceHubPreviewProps } from './workspaceHubPreviewTypes';
import './WorkCenterPreview.scss';

const log = createLogger('WorkCenterPreview');
const SECONDARY_WORK_LIMIT = 2;

function isPreviewAttentionStatus(status: WorkStatus): boolean {
  return isWorkAttentionStatus(status) || status === 'interrupted';
}

function isResumableStatus(status: WorkStatus): boolean {
  return status === 'active' || status === 'paused' || status === 'draft';
}

function getPreviewTone(status: WorkStatus): WorkspaceHubPreviewTone {
  if (status === 'waiting_user' || status === 'blocked') return 'warning';
  if (status === 'failed' || status === 'interrupted') return 'danger';
  if (status === 'completed') return 'positive';
  if (status === 'running') return 'accent';
  return 'neutral';
}

const WorkCenterPreview: React.FC<WorkspaceHubPreviewProps> = ({
  label,
  primaryActionRef,
  onOpenItem,
  onCreateWork,
  onClose,
}) => {
  const { t } = useI18n('common');
  const {
    works,
    projections,
    loaded,
    loading,
    error,
    refreshWorks,
  } = useWorks();

  const workById = useMemo(
    () => new Map(works.map((work) => [work.id, work])),
    [works],
  );
  const eligibleWorks = useMemo(
    () => projections
      .filter((work) => isDockEligibleWork(work) && work.status !== 'archived')
      .sort(compareWorksForDock),
    [projections],
  );
  const attentionWorks = useMemo(
    () => eligibleWorks.filter((work) => isPreviewAttentionStatus(work.status)),
    [eligibleWorks],
  );
  const runningWorks = useMemo(
    () => eligibleWorks.filter((work) => isWorkRunningStatus(work.status)),
    [eligibleWorks],
  );
  const resumableWorks = useMemo(
    () => eligibleWorks.filter((work) => isResumableStatus(work.status)),
    [eligibleWorks],
  );
  const completedWorks = useMemo(
    () => eligibleWorks.filter((work) => work.status === 'completed'),
    [eligibleWorks],
  );
  const focusWork = attentionWorks[0]
    ?? runningWorks[0]
    ?? resumableWorks[0]
    ?? completedWorks[0]
    ?? eligibleWorks[0];
  const secondaryWorks = useMemo(() => {
    if (!focusWork) return [];
    const remaining = eligibleWorks.filter((work) => work.id !== focusWork.id);
    return [
      ...remaining.filter((work) => isWorkRunningStatus(work.status)),
      ...remaining.filter((work) => !isWorkRunningStatus(work.status)),
    ].slice(0, SECONDARY_WORK_LIMIT);
  }, [eligibleWorks, focusWork]);

  const initialLoading = !loaded || (loading && projections.length === 0);
  const hasCachedData = projections.length > 0;

  const openProjection = useCallback(async (projection: WorkProjection) => {
    const record = workById.get(projection.id);
    if (!record) return;
    onClose();
    try {
      await openWork(record);
    } catch (openError) {
      log.error('Failed to open work from workspace hub preview', {
        workId: projection.id,
        error: openError,
      });
    }
  }, [onClose, workById]);

  const status = error
    ? t('nav.menuPanel.hub.preview.workCenter.status.unavailable')
    : initialLoading
      ? t('nav.menuPanel.hub.preview.workCenter.status.loading')
      : undefined;

  const content = (() => {
    if (error && !hasCachedData) {
      return (
        <div className="sparo-workspace-hub-preview__wide">
          <WorkspaceHubPreviewError
            message={t('nav.menuPanel.hub.preview.workCenter.error.loadFailed')}
            retryLabel={t('nav.menuPanel.hub.preview.workCenter.actions.retry')}
            onRetry={() => { void refreshWorks(); }}
          />
        </div>
      );
    }

    if (initialLoading) {
      return (
        <div className="sparo-workspace-hub-preview__wide">
          <WorkspaceHubPreviewLoading rows={3} />
        </div>
      );
    }

    if (!focusWork) {
      return (
        <div className="sparo-workspace-hub-preview__wide sparo-workspace-hub-work-center-preview__empty">
          <WorkspaceHubPreviewEmpty
            title={t('nav.menuPanel.hub.preview.workCenter.empty.noWork')}
          />
        </div>
      );
    }

    const focusTone = getPreviewTone(focusWork.status);
    const focusStatus = t(`nav.menuPanel.hub.preview.workCenter.workStatus.${focusWork.status}`);

    return (
      <div className="sparo-workspace-hub-preview__wide sparo-workspace-hub-work-preview">
        <Button
          variant="ghost"
          size="small"
          className="sparo-workspace-hub-work-preview__focus"
          onClick={() => { void openProjection(focusWork); }}
          aria-label={t('nav.menuPanel.hub.preview.workCenter.aria.openWork', {
            title: focusWork.title,
          })}
        >
          <span
            className={`sparo-workspace-hub-work-preview__focus-icon is-${focusTone}`}
            aria-hidden="true"
          >
            <WorkIcon
              work={focusWork}
              size={28}
              color={getWorkToneValue(focusWork.status)}
            />
          </span>
          <div className="sparo-workspace-hub-work-preview__focus-copy">
            <strong>{focusWork.title}</strong>
            <span className={`sparo-workspace-hub-work-preview__work-status is-${focusTone}`}>
              <span aria-hidden="true" />
              {focusStatus}
            </span>
          </div>
          <ArrowRight
            size={15}
            className="sparo-workspace-hub-work-preview__focus-arrow"
            aria-hidden="true"
          />
        </Button>

        {secondaryWorks.length > 0 && (
          <div className="sparo-workspace-hub-work-preview__tiles">
            {secondaryWorks.map((work) => {
              const tone = getPreviewTone(work.status);
              return (
                <Button
                  key={work.id}
                  variant="ghost"
                  size="small"
                  className="sparo-workspace-hub-work-preview__tile"
                  onClick={() => { void openProjection(work); }}
                  aria-label={t('nav.menuPanel.hub.preview.workCenter.aria.openWork', {
                    title: work.title,
                  })}
                >
                  <span className="sparo-workspace-hub-work-preview__tile-icon" aria-hidden="true">
                    <WorkIcon
                      work={work}
                      size={22}
                      color={getWorkToneValue(work.status)}
                    />
                  </span>
                  <span className="sparo-workspace-hub-work-preview__tile-copy">
                    <strong>{work.title}</strong>
                    <span className={`sparo-workspace-hub-work-preview__work-status is-${tone}`}>
                      <span aria-hidden="true" />
                      {t(`nav.menuPanel.hub.preview.workCenter.workStatus.${work.status}`)}
                    </span>
                  </span>
                </Button>
              );
            })}
          </div>
        )}

        <div className="sparo-workspace-hub-work-preview__pulse" aria-label={label}>
          <span
            className="is-warning"
            aria-label={`${t('nav.menuPanel.hub.preview.workCenter.metrics.attention')} ${attentionWorks.length}`}
          >
            <CircleAlert size={13} aria-hidden="true" />
            <strong>{attentionWorks.length}</strong>
            {t('nav.menuPanel.hub.preview.workCenter.metrics.attention')}
          </span>
          <span
            className="is-accent"
            aria-label={`${t('nav.menuPanel.hub.preview.workCenter.metrics.running')} ${runningWorks.length}`}
          >
            <Activity size={13} aria-hidden="true" />
            <strong>{runningWorks.length}</strong>
            {t('nav.menuPanel.hub.preview.workCenter.metrics.running')}
          </span>
        </div>
      </div>
    );
  })();

  return (
    <WorkspaceHubPreviewFrame
      className="sparo-workspace-hub-work-center-preview"
      title={label}
      status={status}
      statusTone={error ? 'danger' : 'accent'}
      headerMeta={!status ? (
        <div className="sparo-workspace-hub-work-preview__header-actions">
          <IconButton
            variant="ghost"
            size="medium"
            shape="circle"
            aria-label={t('nav.menuPanel.hub.preview.workCenter.actions.newWork')}
            tooltip={t('nav.menuPanel.hub.preview.workCenter.actions.newWork')}
            tooltipPlacement="top"
            onClick={() => onCreateWork()}
          >
            <CirclePlus size={16} aria-hidden="true" />
          </IconButton>
          <IconButton
            ref={primaryActionRef}
            variant="brand"
            size="medium"
            shape="circle"
            aria-label={t('nav.menuPanel.hub.preview.workCenter.actions.openAll')}
            tooltip={t('nav.menuPanel.hub.preview.workCenter.actions.openAll')}
            tooltipPlacement="top"
            onClick={() => onOpenItem('work-center')}
          >
            <LayoutDashboard size={16} aria-hidden="true" />
          </IconButton>
        </div>
      ) : undefined}
    >
      {content}
    </WorkspaceHubPreviewFrame>
  );
};

export default WorkCenterPreview;
