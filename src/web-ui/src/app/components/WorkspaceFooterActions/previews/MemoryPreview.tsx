import React, { useMemo } from 'react';
import {
  Brain,
  Database,
  MessageSquareText,
  Sparkles,
} from 'lucide-react';
import { IconButton } from '@/design-system';
import { backgroundProcessApi } from '@/app/agentic-os/background-process/data/backgroundProcessApi';
import type { BackgroundProcess } from '@/app/agentic-os/background-process/domain/backgroundProcessTypes';
import {
  memoryLibraryAPI,
  type AutoMemoryStatus,
  type MemoryRecord,
  type MemorySpace,
} from '@/app/scenes/memory/MemoryLibraryAPI';
import { useLastUsedWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
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
}

interface MemoryJournalPoint {
  id: string;
  content: string;
  occurredAt: number;
}

interface MemoryJournalRecordPayload {
  time?: unknown;
  content?: unknown;
}

function isSameLocalDay(timestamp: number, reference: Date): boolean {
  const value = new Date(timestamp);
  return value.getFullYear() === reference.getFullYear()
    && value.getMonth() === reference.getMonth()
    && value.getDate() === reference.getDate();
}

function compactMemoryContent(content: string): string {
  const normalized = content
    .replace(/^#+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length <= 46) return normalized;
  return `${normalized.slice(0, 45).trimEnd()}…`;
}

function parseJournalPoints(records: MemoryRecord[], now: Date): MemoryJournalPoint[] {
  const points: MemoryJournalPoint[] = [];

  records
    .filter((record) => record.type === 'memory_log')
    .forEach((record) => {
      record.content.split(/\r?\n/).forEach((line, index) => {
        if (!line.trim()) return;
        try {
          const payload = JSON.parse(line) as MemoryJournalRecordPayload;
          if (typeof payload.time !== 'string' || typeof payload.content !== 'string') return;
          const occurredAt = Date.parse(payload.time);
          if (!Number.isFinite(occurredAt) || !isSameLocalDay(occurredAt, now)) return;
          const content = compactMemoryContent(payload.content);
          if (!content) return;
          points.push({
            id: `${record.id}:${index}`,
            content,
            occurredAt,
          });
        } catch {
          // A malformed journal line should not make the whole preview unavailable.
        }
      });
    });

  return points.sort((left, right) => right.occurredAt - left.occurredAt);
}

function memoryConsolidationSourceCount(process: BackgroundProcess | null): number | null {
  if (!process || process.kind !== 'memory_consolidation') return null;
  const message = process.lastResult?.message?.trim() ?? '';
  const match = /^(\d+)\s+source\(s\)\s+tracked$/i.exec(message);
  return match ? Number(match[1]) : null;
}

const MemoryPreview: React.FC<WorkspaceHubPreviewProps> = ({
  label,
  primaryActionRef,
  onOpenItem,
}) => {
  const { t } = useI18n('common');
  const { workspacePath, workspaceName, hasWorkspace } = useLastUsedWorkspace();
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
      const spaces: MemorySpace[] = [{
        scope: 'global',
        label: 'global',
        memoryDir: storageResult.value.agenticOsMemoryDir,
        available: true,
      }];
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
    };
  });

  const todayPoints = useMemo(
    () => parseJournalPoints(resource.data?.records ?? [], new Date()),
    [resource.data?.records],
  );
  const recentPoints = todayPoints.slice(0, 2);
  const sourceCount = memoryConsolidationSourceCount(
    resource.data?.consolidationProcess ?? null,
  );

  const autoStatus = resource.data?.autoStatus;
  let statusKey = 'nav.menuPanel.hub.preview.memory.status.ready';
  let statusTone: WorkspaceHubPreviewTone = 'positive';
  if (!autoStatus && resource.data?.autoStatusFailed) {
    statusKey = 'nav.menuPanel.hub.preview.common.statusUnavailable';
    statusTone = 'danger';
  } else if (autoStatus && !autoStatus.globalEnabled && !autoStatus.workspaceEnabled) {
    statusKey = 'nav.menuPanel.hub.preview.memory.status.paused';
    statusTone = 'neutral';
  } else if (autoStatus && (!autoStatus.globalEnabled || !autoStatus.workspaceEnabled)) {
    statusKey = 'nav.menuPanel.hub.preview.memory.status.partial';
    statusTone = 'warning';
  }

  const formatPointTime = (timestamp: number): string => new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);

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
          <WorkspaceHubPreviewLoading rows={4} />
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
          <section className="sparo-workspace-hub-memory-preview__growth" aria-labelledby="memory-growth-title">
            <h3 id="memory-growth-title">
              {t('nav.menuPanel.hub.preview.memory.growth.title')}
            </h3>
            <div className="sparo-workspace-hub-memory-preview__metric">
              <strong>{todayPoints.length}</strong>
              <span>{t('nav.menuPanel.hub.preview.memory.growth.unit')}</span>
            </div>
            <p>{t('nav.menuPanel.hub.preview.memory.growth.caption')}</p>
          </section>

          <section className="sparo-workspace-hub-memory-preview__recent" aria-label={t('nav.menuPanel.hub.preview.memory.growth.recent')}>
            <span className="sparo-workspace-hub-memory-preview__section-label">
              {t('nav.menuPanel.hub.preview.memory.growth.recent')}
              {resource.data.recordsPartial && (
                <small>{t('nav.menuPanel.hub.preview.common.partialData')}</small>
              )}
            </span>
            {recentPoints.length > 0 ? (
              <div role="list" className="sparo-workspace-hub-memory-preview__point-list">
                {recentPoints.map((point, index) => (
                  <div key={point.id} role="listitem" className="sparo-workspace-hub-memory-preview__point">
                    <span aria-hidden="true">
                      {index === 0 ? <MessageSquareText size={15} /> : <Sparkles size={15} />}
                    </span>
                    <strong>{point.content}</strong>
                    <time dateTime={new Date(point.occurredAt).toISOString()}>
                      {formatPointTime(point.occurredAt)}
                    </time>
                  </div>
                ))}
              </div>
            ) : (
              <p className="sparo-workspace-hub-memory-preview__empty">
                {t('nav.menuPanel.hub.preview.memory.growth.empty')}
              </p>
            )}
          </section>

          <div className="sparo-workspace-hub-memory-preview__persistence">
            <Database size={17} aria-hidden="true" />
            <span>
              {sourceCount === null
                ? t('nav.menuPanel.hub.preview.memory.growth.persistencePending')
                : t('nav.menuPanel.hub.preview.memory.growth.persistence', { count: sourceCount })}
            </span>
            <span className={`sparo-workspace-hub-memory-preview__auto-status is-${statusTone}`}>
              <span aria-hidden="true" />
              {t(statusKey)}
            </span>
          </div>
        </div>
      )}
    </WorkspaceHubPreviewFrame>
  );
};

export default MemoryPreview;
