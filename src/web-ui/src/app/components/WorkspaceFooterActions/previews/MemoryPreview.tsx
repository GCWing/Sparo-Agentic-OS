import React, { useMemo, useState } from 'react';
import { BookOpen, Brain, Folder, Sparkles, UserRound } from 'lucide-react';
import { Button, IconButton } from '@/design-system';
import {
  backgroundProcessApi,
} from '@/app/agentic-os/background-process/data/backgroundProcessApi';
import type {
  BackgroundProcess,
  BackgroundProcessStatus,
} from '@/app/agentic-os/background-process/domain/backgroundProcessTypes';
import {
  memoryLibraryAPI,
  type AutoMemoryStatus,
  type MemoryRecord,
  type MemorySpace,
} from '@/app/scenes/memory/MemoryLibraryAPI';
import { useLastUsedWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import { notificationService } from '@/shared/notification-system';
import {
  WorkspaceHubPreviewError,
  WorkspaceHubPreviewFrame,
  WorkspaceHubPreviewLoading,
  type WorkspaceHubPreviewTone,
} from './WorkspaceHubPreviewFrame';
import type { WorkspaceHubPreviewProps } from './workspaceHubPreviewTypes';
import { useHubPreviewResource } from './useHubPreviewResource';
import './MemoryPreview.scss';

interface MemoryPreviewData {
  records: MemoryRecord[] | null;
  autoStatus: AutoMemoryStatus | null;
  consolidationProcess: BackgroundProcess | null;
  recordsPartial: boolean;
  autoStatusFailed: boolean;
  consolidationStatusFailed: boolean;
}

interface MemoryPreviewItem {
  id: 'user' | 'long-term' | 'workspace';
  icon: React.ReactNode;
  title: string;
  meta: string;
  updatedAt?: number;
  unavailableLabel?: string;
  tone: WorkspaceHubPreviewTone;
}

const ACTIVE_PROCESS_STATUSES = new Set<BackgroundProcessStatus>(['queued', 'running']);

function memoryConsolidationSourceCount(process: BackgroundProcess | null): number | null {
  if (!process || process.kind !== 'memory_consolidation') return null;
  const message = process.lastResult?.message?.trim() ?? '';
  const match = /^(\d+)\s+source\(s\)\s+tracked$/i.exec(message);
  return match ? Number(match[1]) : null;
}

function memoryConsolidationFinishedAt(process: BackgroundProcess | null): number | null {
  return process?.lastResult?.finishedAt ?? process?.finishedAt ?? null;
}

const MemoryPreview: React.FC<WorkspaceHubPreviewProps> = ({
  label,
  primaryActionRef,
  onOpenItem,
}) => {
  const { t } = useI18n('common');
  const { workspacePath, workspaceName, hasWorkspace } = useLastUsedWorkspace();
  const [isConsolidating, setIsConsolidating] = useState(false);
  const key = `workspace-hub:memory:${workspacePath || 'global'}`;

  const resource = useHubPreviewResource<MemoryPreviewData>(key, async () => {
    const [storageResult, workspaceResult, autoStatusResult, processResult] = await Promise.all([
      Promise.resolve(memoryLibraryAPI.getStoragePaths()).then(
        (value) => ({ ok: true as const, value }),
        (reason) => ({ ok: false as const, value: null, reason }),
      ),
      hasWorkspace && workspacePath
        ? Promise.resolve(memoryLibraryAPI.getWorkspaceStoragePaths(workspacePath)).then(
            (value) => ({ ok: true as const, value }),
            () => ({ ok: false as const, value: null }),
          )
        : Promise.resolve({ ok: true as const, value: null }),
      Promise.resolve(memoryLibraryAPI.getAutoMemoryStatus()).then(
        (value) => ({ ok: true as const, value }),
        () => ({ ok: false as const, value: null }),
      ),
      Promise.resolve(backgroundProcessApi.listProcesses()).then(
        (value) => ({ ok: true as const, value }),
        () => ({ ok: false as const, value: null }),
      ),
    ]);

    if (!storageResult.ok && !autoStatusResult.ok && !processResult.ok) {
      throw storageResult.reason;
    }

    let records: MemoryRecord[] | null = null;
    let recordsPartial = false;
    if (storageResult.ok) {
      const spaces: MemorySpace[] = [
        {
          scope: 'global',
          label: 'global',
          memoryDir: storageResult.value.agenticOsMemoryDir,
          available: true,
        },
        {
          scope: 'global',
          label: 'global',
          memoryDir: storageResult.value.agenticOsHostDir,
          available: true,
        },
        {
          scope: 'global',
          label: 'global',
          memoryDir: storageResult.value.agenticOsWorkspacesOverviewDir,
          available: true,
        },
      ];
      if (workspaceResult.ok && workspaceResult.value) {
        spaces.push({
          scope: 'workspace',
          label: workspaceName || 'workspace',
          memoryDir: workspaceResult.value.memoryDir,
          available: true,
        });
      } else if (hasWorkspace) {
        recordsPartial = true;
      }

      const recordResults = await Promise.allSettled(
        spaces.map((space) => memoryLibraryAPI.listExistingMemoryRecords(space)),
      );
      const fulfilled = recordResults
        .filter((result): result is PromiseFulfilledResult<MemoryRecord[]> => result.status === 'fulfilled')
        .flatMap((result) => result.value);
      recordsPartial ||= recordResults.some((result) => result.status === 'rejected');
      records = recordResults.every((result) => result.status === 'rejected') ? null : fulfilled;
    }

    return {
      records,
      autoStatus: autoStatusResult.value,
      consolidationProcess: processResult.value?.processes.find(
        (process) => process.kind === 'memory_consolidation',
      ) ?? null,
      recordsPartial,
      autoStatusFailed: !autoStatusResult.ok,
      consolidationStatusFailed: !processResult.ok,
    };
  });

  const items = useMemo<MemoryPreviewItem[]>(() => {
    const records = resource.data?.records ?? [];
    const userRecord = records.find(
      (record) => record.scope === 'global' && record.type === 'user',
    );
    const longTermRecord = records.find(
      (record) => record.scope === 'global' && record.type === 'memory' && !record.isWorkspaceOverview,
    );
    const workspaceRecord = records.find(
      (record) => record.scope === 'workspace' && record.type === 'memory',
    );

    return [
      {
        id: 'user',
        icon: <UserRound size={16} />,
        title: t('nav.menuPanel.hub.preview.memory.items.user.title'),
        meta: t('nav.menuPanel.hub.preview.memory.items.user.meta'),
        updatedAt: userRecord?.updatedAt,
        tone: 'accent',
      },
      {
        id: 'long-term',
        icon: <BookOpen size={16} />,
        title: t('nav.menuPanel.hub.preview.memory.items.longTerm.title'),
        meta: t('nav.menuPanel.hub.preview.memory.items.longTerm.meta'),
        updatedAt: longTermRecord?.updatedAt,
        tone: 'accent',
      },
      {
        id: 'workspace',
        icon: <Folder size={16} />,
        title: t('nav.menuPanel.hub.preview.memory.items.workspace.title'),
        meta: t('nav.menuPanel.hub.preview.memory.items.workspace.meta'),
        updatedAt: workspaceRecord?.updatedAt,
        unavailableLabel: hasWorkspace
          ? undefined
          : t('nav.menuPanel.hub.preview.memory.updated.noWorkspace'),
        tone: 'neutral',
      },
    ];
  }, [hasWorkspace, resource.data?.records, t]);

  const formatUpdatedAt = (item: MemoryPreviewItem): string => {
    if (item.unavailableLabel) return item.unavailableLabel;
    if (!item.updatedAt) return t('nav.menuPanel.hub.preview.memory.updated.unavailable');

    const updated = new Date(item.updatedAt);
    const now = new Date();
    const elapsedHours = (now.getTime() - updated.getTime()) / 3_600_000;
    if (elapsedHours >= 0 && elapsedHours < 1) {
      return t('nav.menuPanel.hub.preview.memory.updated.today');
    }

    const hoursAgo = Math.max(1, Math.floor(elapsedHours));
    if (hoursAgo < 24) {
      return t('nav.menuPanel.hub.preview.memory.updated.hoursAgo', { count: hoursAgo });
    }

    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(updated);
  };

  const autoStatus = resource.data?.autoStatus;
  let statusKey = 'nav.menuPanel.hub.preview.memory.status.ready';
  let statusTone: WorkspaceHubPreviewTone = 'positive';
  if (resource.loading && !resource.data) {
    statusKey = 'nav.menuPanel.hub.preview.common.loading';
    statusTone = 'neutral';
  } else if (resource.error && !resource.data) {
    statusKey = 'nav.menuPanel.hub.preview.common.statusUnavailable';
    statusTone = 'danger';
  } else if (!autoStatus && resource.data?.autoStatusFailed) {
    statusKey = 'nav.menuPanel.hub.preview.common.statusUnavailable';
    statusTone = 'danger';
  } else if (autoStatus && !autoStatus.globalEnabled && !autoStatus.workspaceEnabled) {
    statusKey = 'nav.menuPanel.hub.preview.memory.status.paused';
    statusTone = 'neutral';
  } else if (autoStatus && (!autoStatus.globalEnabled || !autoStatus.workspaceEnabled)) {
    statusKey = 'nav.menuPanel.hub.preview.memory.status.partial';
    statusTone = 'warning';
  }

  const consolidationProcess = resource.data?.consolidationProcess ?? null;
  const processActive = Boolean(
    consolidationProcess && ACTIVE_PROCESS_STATUSES.has(consolidationProcess.status),
  );
  const consolidationActive = isConsolidating || processActive;
  const consolidationFinishedAt = memoryConsolidationFinishedAt(consolidationProcess);
  const sourceCount = memoryConsolidationSourceCount(consolidationProcess);

  let consolidationStateKey = 'nav.menuPanel.hub.preview.memory.consolidation.state.ready';
  let consolidationStateClass = 'is-ready';
  if (consolidationActive) {
    consolidationStateKey = 'nav.menuPanel.hub.preview.memory.consolidation.state.running';
    consolidationStateClass = 'is-running';
  } else if (consolidationProcess?.status === 'failed') {
    consolidationStateKey = 'nav.menuPanel.hub.preview.memory.consolidation.state.failed';
    consolidationStateClass = 'is-failed';
  } else if (consolidationProcess?.status === 'disabled') {
    consolidationStateKey = 'nav.menuPanel.hub.preview.memory.consolidation.state.disabled';
    consolidationStateClass = 'is-disabled';
  } else if (!consolidationFinishedAt) {
    consolidationStateKey = 'nav.menuPanel.hub.preview.memory.consolidation.state.notRun';
    consolidationStateClass = 'is-idle';
  }

  const consolidationMeta = (() => {
    if (resource.data?.consolidationStatusFailed) {
      return t('nav.menuPanel.hub.preview.memory.consolidation.statusUnavailable');
    }
    if (consolidationActive) {
      return t('nav.menuPanel.hub.preview.memory.consolidation.runningMeta');
    }
    if (!consolidationFinishedAt) {
      return t('nav.menuPanel.hub.preview.memory.consolidation.notRunMeta');
    }

    const time = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(consolidationFinishedAt);
    return sourceCount === null
      ? t('nav.menuPanel.hub.preview.memory.consolidation.lastRun', { time })
      : t('nav.menuPanel.hub.preview.memory.consolidation.summary', { count: sourceCount, time });
  })();

  const runConsolidation = async () => {
    setIsConsolidating(true);
    try {
      const response = await backgroundProcessApi.runProcess('memory_consolidation');
      if (response.started) {
        notificationService.success(
          t('nav.menuPanel.hub.preview.memory.consolidation.messages.started'),
          { duration: 2500 },
        );
      } else {
        notificationService.info(
          t('nav.menuPanel.hub.preview.memory.consolidation.messages.notNeeded'),
          { duration: 2500 },
        );
      }
      await resource.refresh();
    } catch {
      notificationService.error(
        t('nav.menuPanel.hub.preview.memory.consolidation.messages.failed'),
      );
    } finally {
      setIsConsolidating(false);
    }
  };

  return (
    <WorkspaceHubPreviewFrame
      className="sparo-workspace-hub-memory-preview"
      title={label}
      headerMeta={(
        <IconButton
          ref={primaryActionRef}
          variant="brand"
          size="medium"
          shape="circle"
          aria-label={t('nav.menuPanel.hub.preview.memory.actions.open')}
          tooltip={t('nav.menuPanel.hub.preview.memory.actions.open')}
          tooltipPlacement="top"
          onClick={() => onOpenItem('memory')}
        >
          <Brain size={16} aria-hidden="true" />
        </IconButton>
      )}
    >
      {resource.loading && !resource.data ? (
        <div className="sparo-workspace-hub-preview__wide">
          <WorkspaceHubPreviewLoading rows={3} />
        </div>
      ) : resource.error || !resource.data ? (
        <div className="sparo-workspace-hub-preview__wide">
          <WorkspaceHubPreviewError
            message={t('nav.menuPanel.hub.preview.memory.errors.load')}
            retryLabel={t('nav.menuPanel.hub.preview.common.retry')}
            onRetry={resource.refresh}
          />
        </div>
      ) : (
        <div className="sparo-workspace-hub-preview__wide sparo-workspace-hub-memory-preview__body">
          <div className={`sparo-workspace-hub-memory-preview__auto-status is-${statusTone}`}>
            <span aria-hidden="true" />
            {t(statusKey)}
            {resource.data.recordsPartial && (
              <small>{t('nav.menuPanel.hub.preview.common.partialData')}</small>
            )}
          </div>

          {resource.data.records === null ? (
            <WorkspaceHubPreviewError
              message={t('nav.menuPanel.hub.preview.memory.errors.records')}
              retryLabel={t('nav.menuPanel.hub.preview.common.retry')}
              onRetry={resource.refresh}
            />
          ) : (
            <div
              className="sparo-workspace-hub-memory-preview__constellation"
              role="list"
              aria-label={t('nav.menuPanel.hub.preview.memory.sections.current')}
            >
              {items.map((item) => (
                <div
                  key={item.id}
                  role="listitem"
                  className={`sparo-workspace-hub-memory-preview__memory-node is-${item.tone}`}
                  aria-label={`${item.title}, ${item.meta}, ${formatUpdatedAt(item)}`}
                >
                  <span className="sparo-workspace-hub-memory-preview__memory-node-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <strong>{item.title}</strong>
                  <span>{formatUpdatedAt(item)}</span>
                </div>
              ))}
            </div>
          )}

          <section
            className={`sparo-workspace-hub-memory-preview__consolidation ${consolidationStateClass}`}
            aria-label={t('nav.menuPanel.hub.preview.memory.consolidation.ariaLabel')}
            aria-live="polite"
          >
            <span className="sparo-workspace-hub-memory-preview__consolidation-icon" aria-hidden="true">
              <Sparkles size={17} />
            </span>
            <span className="sparo-workspace-hub-memory-preview__consolidation-copy">
              <strong>{t(consolidationStateKey)}</strong>
              <span>{consolidationMeta}</span>
            </span>
            <Button
              variant="ghost"
              size="small"
              shape="pill"
              isLoading={consolidationActive}
              loadingLabel={t('nav.menuPanel.hub.preview.memory.consolidation.actions.running')}
              disabled={consolidationProcess?.status === 'disabled'}
              onClick={() => void runConsolidation()}
            >
              <Sparkles size={14} aria-hidden="true" />
              {t('nav.menuPanel.hub.preview.memory.consolidation.actions.run')}
            </Button>
          </section>
        </div>
      )}
    </WorkspaceHubPreviewFrame>
  );
};

export default MemoryPreview;
