import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AppWindow,
  ListChecks,
  Play,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { Badge, IconButton, type BadgeVariant } from '@/design-system';
import { useI18n } from '@/infrastructure/i18n';
import type { BackgroundProcess } from '@/app/agentic-os/background-process/domain/backgroundProcessTypes';
import { getWorkRailSection } from '@/app/agentic-os/work/domain/workClassification';
import { useWorkStore } from '@/app/agentic-os/work/data/workStore';
import type { WorkProjection } from '@/app/agentic-os/work/projections/workProjection';
import type { WorkspaceInfo } from '@/shared/types';
import { getWorkspaceDisplayName } from '@/infrastructure/contexts/WorkspaceContext';
import './RunningWorkProcessTable.scss';

interface RunningWorkProcessTableProps {
  works: WorkProjection[];
  workspaces: WorkspaceInfo[];
  backgroundProcesses: BackgroundProcess[];
  selectedWorkId: string | null;
  onSelectWork: (work: WorkProjection) => void;
  onCancelWork: (work: WorkProjection) => void;
  onRunSystemProcess?: (kind: BackgroundProcess['kind']) => void;
  systemRunSubmittingKind?: string | null;
}

function kindKey(kind: string): string {
  return kind.replace(/_/g, '-');
}

function compactId(id: string): string {
  if (id.length <= 18) return id;
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}

function formatClock(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleTimeString();
  }
}

function formatDuration(ms: number | null, emptyValue: string): string {
  if (ms == null || ms < 0) return emptyValue;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function processIcon(work: WorkProjection): React.ReactNode {
  if (work.systemManaged) return <Sparkles size={14} />;
  if (work.kind === 'app_workflow') return <AppWindow size={14} />;
  return <ListChecks size={14} />;
}

function statusVariant(work: WorkProjection): BadgeVariant {
  if (work.systemManaged) return 'info';
  return 'accent';
}

const RunningWorkProcessTable: React.FC<RunningWorkProcessTableProps> = ({
  works,
  workspaces,
  backgroundProcesses,
  selectedWorkId,
  onSelectWork,
  onCancelWork,
  onRunSystemProcess,
  systemRunSubmittingKind = null,
}) => {
  const { t } = useI18n('scenes/work-center');
  const workRecords = useWorkStore((state) => state.works);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const processByKind = useMemo(() => {
    const map = new Map<string, BackgroundProcess>();
    for (const process of backgroundProcesses) {
      map.set(process.kind, process);
    }
    return map;
  }, [backgroundProcesses]);

  const startedAtByWorkId = useMemo(() => {
    const map = new Map<string, number>();
    for (const record of workRecords) {
      const runningBinding = record.executionBindings.find(
        (binding) => binding.status === 'running'
      );
      if (runningBinding) {
        map.set(record.id, runningBinding.createdAt);
      }
    }
    return map;
  }, [workRecords]);

  const rows = useMemo(() => {
    return [...works].sort((left, right) => {
      if (left.systemManaged !== right.systemManaged) {
        return left.systemManaged ? 1 : -1;
      }
      return right.updatedAt - left.updatedAt;
    });
  }, [works]);

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="rw-table-wrap" data-testid="running-work-process-table">
      <table className="rw-table">
        <thead>
          <tr>
            <th>{t('runningTable.columns.name')}</th>
            <th>{t('runningTable.columns.status')}</th>
            <th>{t('runningTable.columns.type')}</th>
            <th>{t('runningTable.columns.scope')}</th>
            <th>{t('runningTable.columns.kind')}</th>
            <th>{t('runningTable.columns.phase')}</th>
            <th>{t('runningTable.columns.runtime')}</th>
            <th>{t('runningTable.columns.updated')}</th>
            <th aria-label={t('runningTable.columns.actions')} />
          </tr>
        </thead>
        <tbody>
          {rows.map((work) => {
            const rail = getWorkRailSection(work);
            const process = work.systemManaged && work.systemProcessKind
              ? processByKind.get(work.systemProcessKind)
              : undefined;
            const startedAt = process?.startedAt
              ?? startedAtByWorkId.get(work.id)
              ?? null;
            const runtimeMs = startedAt != null ? now - startedAt : null;
            const workspace = work.workspacePath
              ? workspaces.find((item) => item.rootPath === work.workspacePath)
              : undefined;
            const scopeLabel = workspace
              ? getWorkspaceDisplayName(workspace)
              : (work.workspacePath ?? t('detail.globalWorkspace'));
            const statusLabel = work.systemManaged
              ? t('runtime.background')
              : t(`status.${work.status}`);
            const phaseLabel = process?.phase
              ? t(`background.phase.${process.phase}`)
              : t('runningTable.emptyValue');
            const canCancel = !work.systemManaged;
            const canRun = Boolean(
              work.systemManaged
              && process?.actions.includes('run_now')
              && onRunSystemProcess
              && process
            );
            const selected = selectedWorkId === work.id;

            return (
              <tr
                key={work.id}
                className={[
                  'rw-table__row',
                  selected && 'is-selected',
                  work.systemManaged && 'is-system',
                  !work.systemManaged && 'is-active',
                ].filter(Boolean).join(' ')}
                onClick={() => onSelectWork(work)}
                data-sparo-work-id={work.id}
              >
                <td className="rw-name-cell">
                  <span className="rw-name-cell__icon" aria-hidden="true">
                    {processIcon(work)}
                  </span>
                  <span className="rw-name-cell__text">
                    <span className="rw-name-cell__title">{work.title}</span>
                    <span className="rw-name-cell__id" title={work.id}>
                      {compactId(work.id)}
                    </span>
                  </span>
                </td>
                <td>
                  <Badge variant={statusVariant(work)} className="rw-status-badge">
                    <span className="rw-status-badge__icon" aria-hidden="true">
                      <Activity size={12} />
                    </span>
                    {statusLabel}
                  </Badge>
                </td>
                <td>
                  <Badge variant={work.systemManaged ? 'neutral' : 'info'}>
                    {t(`rail.${rail}`)}
                  </Badge>
                </td>
                <td title={scopeLabel}>{scopeLabel}</td>
                <td>{t(`kind.${kindKey(work.kind)}`)}</td>
                <td title={phaseLabel}>{phaseLabel}</td>
                <td className="rw-table__mono">
                  {formatDuration(runtimeMs, t('runningTable.emptyValue'))}
                </td>
                <td className="rw-table__mono">{formatClock(work.updatedAt)}</td>
                <td>
                  <div
                    className="rw-row-actions"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    {canCancel ? (
                      <IconButton
                        size="xs"
                        variant="ghost"
                        aria-label={t('actions.cancelWork')}
                        tooltip={t('actions.cancelWork')}
                        onClick={() => onCancelWork(work)}
                      >
                        <XCircle size={13} />
                      </IconButton>
                    ) : null}
                    {canRun && process && onRunSystemProcess ? (
                      <IconButton
                        size="xs"
                        variant="ghost"
                        aria-label={t('detail.systemRuntime.runNow')}
                        tooltip={t('detail.systemRuntime.runNow')}
                        disabled={systemRunSubmittingKind === process.kind}
                        onClick={() => onRunSystemProcess(process.kind)}
                      >
                        <Play size={13} />
                      </IconButton>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default RunningWorkProcessTable;
