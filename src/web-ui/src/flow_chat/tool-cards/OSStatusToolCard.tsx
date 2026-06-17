import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ToolCardProps } from '../types/flow-chat';
import { getToolViewState } from '../runtime/toolViewState';
import { DefaultToolCardTemplate } from './templates';
import { ToolErrorBlock } from './ToolErrorBlock';
import { ToolStructuredDetails } from './ToolStructuredDetails';
import './OSStatusToolCard.scss';

const MAX_VISIBLE_WORKS = 6;

type JsonRecord = Record<string, any>;
type OSStatusAction = 'overview' | 'works' | string;
type OSStatusWorkScopeMode = 'current_workspace' | 'system' | 'all' | 'workspace_path' | string;
type Translate = (key: string, options?: Record<string, any>) => string;

interface OSStatusInput {
  action?: OSStatusAction;
  work_id?: string;
  limit?: number;
  include_archived?: boolean;
  work_scope?: OSStatusWorkScopeMode;
  workspace_path?: string;
}

interface OSStatusSession {
  agentType?: string;
  agent_type?: string;
  sessionId?: string;
  session_id?: string;
}

interface OSStatusWorkspace {
  kind?: string;
  root?: string | null;
  workspaceId?: string;
  workspace_id?: string;
  isRemote?: boolean;
  is_remote?: boolean;
}

interface OSStatusWork {
  id?: string;
  title?: string;
  objective?: string;
  status?: string;
  running?: boolean;
  updatedAt?: number;
  updated_at?: number;
  scope?: unknown;
  primarySurface?: unknown;
  primary_surface?: unknown;
}

interface OSStatusWorkScope {
  mode?: OSStatusWorkScopeMode;
  filter?: string;
  workspacePath?: string | null;
  workspace_path?: string | null;
}

interface OSStatusResult {
  action?: OSStatusAction;
  session?: OSStatusSession;
  workspace?: OSStatusWorkspace;
  workScope?: OSStatusWorkScope;
  work_scope?: OSStatusWorkScope;
  workCount?: number;
  work_count?: number;
  activeWorkCount?: number;
  active_work_count?: number;
  works?: unknown[];
}

function parseData<T>(value: unknown): T | null {
  if (!value) return null;

  try {
    return typeof value === 'string' ? JSON.parse(value) as T : value as T;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function stringValue(record: JsonRecord | null | undefined, ...keys: string[]): string | undefined {
  if (!record) return undefined;

  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function numberValue(record: JsonRecord | null | undefined, ...keys: string[]): number | undefined {
  if (!record) return undefined;

  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return undefined;
}

function booleanValue(record: JsonRecord | null | undefined, ...keys: string[]): boolean | undefined {
  if (!record) return undefined;

  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') {
      return value;
    }
  }

  return undefined;
}

function normalizeWork(value: unknown): OSStatusWork | null {
  const record = asRecord(value);
  if (!record) return null;

  return {
    id: stringValue(record, 'id'),
    title: stringValue(record, 'title'),
    objective: stringValue(record, 'objective'),
    status: stringValue(record, 'status'),
    running: booleanValue(record, 'running'),
    updatedAt: numberValue(record, 'updatedAt', 'updated_at'),
    updated_at: numberValue(record, 'updated_at'),
    scope: record.scope,
    primarySurface: record.primarySurface ?? record.primary_surface,
    primary_surface: record.primary_surface,
  };
}

function getPathTail(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '');
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function getWorkspaceDisplay(t: Translate, workspace?: OSStatusWorkspace): { label: string; title?: string } {
  const root = workspace?.root?.trim();
  if (root) {
    return { label: getPathTail(root), title: root };
  }

  const workspaceId = workspace?.workspaceId ?? workspace?.workspace_id;
  if (workspaceId) {
    return { label: workspaceId, title: workspaceId };
  }

  return { label: t('toolCards.osStatus.unknownWorkspace') };
}

function normalizeWorkScope(result: OSStatusResult, input: OSStatusInput): OSStatusWorkScope {
  const resultScope = asRecord(result.workScope ?? result.work_scope);
  if (resultScope) {
    return {
      mode: stringValue(resultScope, 'mode') ?? input.work_scope,
      filter: stringValue(resultScope, 'filter'),
      workspacePath: stringValue(resultScope, 'workspacePath', 'workspace_path') ?? null,
    };
  }

  const workspacePath = input.workspace_path?.trim();
  return {
    mode: workspacePath ? 'workspace_path' : input.work_scope ?? 'current_workspace',
    filter: workspacePath ? 'workspace' : undefined,
    workspacePath: workspacePath || null,
  };
}

function getWorkScopeDisplay(
  t: Translate,
  workScope: OSStatusWorkScope,
  workspace?: OSStatusWorkspace,
): { label: string; title?: string } {
  const mode = workScope.mode ?? 'current_workspace';
  const filter = workScope.filter;
  const workspacePath = workScope.workspacePath ?? workScope.workspace_path ?? workspace?.root ?? undefined;

  if (filter === 'all' || mode === 'all') {
    return { label: t('toolCards.osStatus.scopeAll') };
  }
  if (filter === 'system' || mode === 'system') {
    return { label: t('toolCards.osStatus.scopeSystem') };
  }
  if (mode === 'workspace_path') {
    return { label: t('toolCards.osStatus.scopeWorkspacePath'), title: workspacePath ?? undefined };
  }

  return { label: t('toolCards.osStatus.scopeCurrentWorkspace'), title: workspacePath ?? undefined };
}

function getStatusLabel(t: Translate, status?: string): string | undefined {
  if (!status) return undefined;
  return t(`toolCards.work.status.${status}`, { defaultValue: status });
}

function getSurfaceLabel(t: Translate, surfaceValue: unknown): string | undefined {
  const surface = asRecord(surfaceValue);
  const kind = stringValue(surface, 'kind');
  if (!kind) return undefined;
  return t(`toolCards.work.surface.${kind}`, { defaultValue: kind });
}

function formatUpdatedAt(timestamp?: number): string | undefined {
  if (!timestamp || !Number.isFinite(timestamp)) return undefined;

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return undefined;

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function statusModifier(status?: string): string {
  return (status || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}

function getSummaryText(
  t: Translate,
  phase: ReturnType<typeof getToolViewState>['phase'],
  action: OSStatusAction,
  workCount: number,
  workScopeLabel: string,
  targetWorkId: string | undefined,
  firstWorkTitle: string,
): string {
  if (phase === 'cancelled') {
    return t('toolCards.osStatus.cancelled');
  }
  if (phase === 'interrupted') {
    return t('toolCards.osStatus.interrupted');
  }
  if (phase === 'error') {
    return t('toolCards.osStatus.failed');
  }

  if (phase === 'running' || phase === 'receiving_input') {
    return t('toolCards.osStatus.checking');
  }
  if (phase === 'preparing' || phase === 'ready') {
    return t('toolCards.osStatus.preparing');
  }

  if (action === 'works') {
    return targetWorkId
      ? t('toolCards.osStatus.workComplete', { title: firstWorkTitle })
      : t('toolCards.osStatus.worksComplete', { count: workCount });
  }

  return workCount > 0
    ? t('toolCards.osStatus.overviewComplete', { count: workCount, scope: workScopeLabel })
    : t('toolCards.osStatus.overviewEmpty', { scope: workScopeLabel });
}

function renderPathLabel(label: string, title?: string): React.ReactNode {
  return (
    <span className="os-status-card__path" title={title ?? label}>
      {label}
    </span>
  );
}

export const OSStatusToolCard: React.FC<ToolCardProps> = React.memo(({ toolItem }) => {
  const { t } = useTranslation('flow-chat');
  const { toolCall, toolResult, status } = toolItem;
  const viewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
  const isCompleted = viewState.phase === 'result';
  const toolId = toolItem.id ?? toolCall?.id;

  const inputData = useMemo(
    () => parseData<OSStatusInput>(toolCall?.input) ?? {},
    [toolCall?.input],
  );
  const resultData = useMemo(
    () => parseData<OSStatusResult>(toolResult?.result) ?? {},
    [toolResult?.result],
  );

  const action = resultData.action ?? inputData.action ?? 'overview';
  const workspace = resultData.workspace;
  const workspaceDisplay = getWorkspaceDisplay(t, workspace);
  const workScope = normalizeWorkScope(resultData, inputData);
  const workScopeDisplay = getWorkScopeDisplay(t, workScope, workspace);
  const session = resultData.session;
  const sessionRecord = asRecord(session);
  const workspaceRecord = asRecord(workspace);
  const works = useMemo(
    () => (Array.isArray(resultData.works) ? resultData.works : [])
      .map(normalizeWork)
      .filter((work): work is OSStatusWork => Boolean(work)),
    [resultData.works],
  );
  const workCount = numberValue(asRecord(resultData), 'workCount', 'work_count', 'activeWorkCount', 'active_work_count') ?? works.length;
  const visibleWorks = works.slice(0, MAX_VISIBLE_WORKS);
  const hiddenWorkCount = Math.max(0, works.length - MAX_VISIBLE_WORKS);
  const firstWork = works[0];
  const firstWorkTitle =
    firstWork?.title ||
    inputData.work_id ||
    t('toolCards.osStatus.untitledWork');
  const agentType = stringValue(sessionRecord, 'agentType', 'agent_type');
  const sessionId = stringValue(sessionRecord, 'sessionId', 'session_id');
  const isRemote = booleanValue(workspaceRecord, 'isRemote', 'is_remote');
  const scopeLabel = isRemote === true
    ? t('toolCards.osStatus.remoteScope')
    : t('toolCards.osStatus.localScope');
  const metaItems = [
    {
      label: t('toolCards.osStatus.workspaceLabel'),
      value: renderPathLabel(workspaceDisplay.label, workspaceDisplay.title),
    },
    {
      label: t('toolCards.osStatus.workScopeLabel'),
      value: renderPathLabel(workScopeDisplay.label, workScopeDisplay.title),
    },
    {
      label: t('toolCards.osStatus.scopeLabel'),
      value: scopeLabel,
      hidden: isRemote === undefined,
    },
    {
      label: t('toolCards.osStatus.agentLabel'),
      value: agentType,
      hidden: !agentType,
    },
    {
      label: t('toolCards.osStatus.workCountLabel'),
      value: action === 'overview' ? workCount : undefined,
      hidden: action !== 'overview',
    },
    {
      label: t('toolCards.osStatus.sessionLabel'),
      value: sessionId ? <span className="os-status-card__mono">{sessionId}</span> : undefined,
      hidden: !sessionId,
      className: 'os-status-card__meta-item--session',
    },
  ].filter(item => !item.hidden && item.value !== undefined && item.value !== null && item.value !== '');
  const hasDetails = Boolean(
    workspace ||
    session ||
    works.length ||
    isCompleted ||
    toolResult?.error,
  );

  const expandedContent = hasDetails ? (
    <ToolStructuredDetails
      className="os-status-card__details"
    >
      {metaItems.length > 0 && (
        <div className="os-status-card__meta-strip">
          {metaItems.map((item, index) => (
            <div
              key={`${item.label}-${index}`}
              className={['os-status-card__meta-item', item.className].filter(Boolean).join(' ')}
            >
              <span className="os-status-card__meta-label">{item.label}</span>
              <span className="os-status-card__meta-value">{item.value}</span>
            </div>
          ))}
        </div>
      )}

      {visibleWorks.length > 0 && (
        <div className="os-status-card__work-list" aria-label={t('toolCards.osStatus.listLabel')}>
          {visibleWorks.map((work, index) => {
            const workTitle = work.title || t('toolCards.osStatus.untitledWork');
            const statusLabel = getStatusLabel(t, work.status);
            const surfaceLabel = getSurfaceLabel(t, work.primarySurface ?? work.primary_surface);
            const updatedAt = formatUpdatedAt(work.updatedAt ?? work.updated_at);

            return (
              <div className="os-status-card__work-row" key={`${work.id ?? workTitle}-${index}`}>
                <div className="os-status-card__work-main">
                  <span className="os-status-card__work-title" title={workTitle}>
                    {workTitle}
                  </span>
                  {statusLabel && (
                    <span className={`os-status-card__work-status os-status-card__work-status--${statusModifier(work.status)}`}>
                      {statusLabel}
                    </span>
                  )}
                </div>
                {work.objective && (
                  <div className="os-status-card__work-objective" title={work.objective}>
                    {work.objective}
                  </div>
                )}
                <div className="os-status-card__work-meta">
                  {work.id && (
                    <span className="os-status-card__mono" title={work.id}>
                      {t('toolCards.osStatus.workId')}: {work.id}
                    </span>
                  )}
                  {surfaceLabel && <span>{surfaceLabel}</span>}
                  {updatedAt && <span>{t('toolCards.osStatus.updated')}: {updatedAt}</span>}
                </div>
              </div>
            );
          })}
          {hiddenWorkCount > 0 && (
            <div className="os-status-card__more">
              {t('toolCards.osStatus.moreWorks', { count: hiddenWorkCount })}
            </div>
          )}
        </div>
      )}

      {isCompleted && works.length === 0 && (
        <div className="os-status-card__empty">
          {t('toolCards.osStatus.noWorks')}
        </div>
      )}

      {toolResult?.error && <ToolErrorBlock message={toolResult.error} />}
    </ToolStructuredDetails>
  ) : undefined;

  return (
    <DefaultToolCardTemplate
      toolId={toolId}
      toolName={toolItem.toolName}
      status={status}
      className="os-status-card"
      action={`${t('toolCards.osStatus.title')}:`}
      summary={getSummaryText(
        t,
        viewState.phase,
        action,
        workCount,
        workScopeDisplay.label,
        inputData.work_id,
        firstWorkTitle,
      )}
      extra={
        isCompleted
          ? <span className="os-status-card__count">{workCount}</span>
          : undefined
      }
      expandedContent={expandedContent}
    />
  );
});

OSStatusToolCard.displayName = 'OSStatusToolCard';
