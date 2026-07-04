import React, { useCallback, useMemo } from 'react';
import { Check, Clock, ExternalLink, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DotMatrixLoader } from '@/design-system';
import { openWork, openWorkInCenter } from '@/app/agentic-os/work/navigation/openWork';
import type {
  WorkAppRef,
  WorkAppIntent,
  WorkAppRelation,
  WorkSubject,
  WorkAssignmentRef,
  WorkRecord,
  WorkScope,
  WorkSurfaceRef,
} from '@/app/agentic-os/work/domain/workTypes';
import { createLogger } from '@/shared/utils/logger';
import type { ToolCardProps } from '../types/flow-chat';
import { getToolViewState } from '../runtime/toolViewState';
import { DefaultToolCardTemplate } from './templates';
import { ToolErrorBlock } from './ToolErrorBlock';
import './WorkToolCard.scss';

const log = createLogger('WorkToolCard');

type JsonRecord = Record<string, any>;
type Translate = (key: string, options?: Record<string, any>) => string;

interface WorkToolInput {
  action?: 'start' | 'continue' | 'status' | 'control';
  work_id?: string;
  kind?: string;
  title?: string;
  objective?: string;
  instructions?: string;
  scope?: unknown;
  executor?: unknown;
  control_action?: string;
}

interface WorkToolResult {
  action?: 'start' | 'continue' | 'status' | 'control';
  work_id?: string;
  status?: string;
  surface?: unknown;
  execution?: unknown;
  work?: unknown;
  works?: unknown[];
  success?: boolean;
}

interface WorkDetailTableRow {
  label: React.ReactNode;
  value: React.ReactNode;
  hidden?: boolean;
  className?: string;
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

function normalizeSurface(rawValue: unknown, fallbackWorkId: string): WorkSurfaceRef | null {
  const raw = asRecord(rawValue);
  if (!raw) return null;

  const kind = stringValue(raw, 'kind');
  switch (kind) {
    case 'os_agent_home':
      return {
        kind: 'os_agent_home',
        agenticOsSessionId: stringValue(
          raw,
          'agenticOsSessionId',
          'agentic_os_session_id',
          'dispatcher_session_id'
        ) ?? null,
      };
    case 'work_session': {
      const sessionId = stringValue(raw, 'sessionId', 'session_id');
      return sessionId ? { kind: 'work_session', sessionId } : null;
    }
    case 'agent_session': {
      const sessionId = stringValue(raw, 'sessionId', 'session_id');
      return sessionId ? { kind: 'agent_session', sessionId } : null;
    }
    case 'work_center':
      return {
        kind: 'work_center',
        workId: stringValue(raw, 'workId', 'work_id') ?? fallbackWorkId,
      };
    case 'application_surface': {
      const productAppId = stringValue(raw, 'productAppId', 'product_app_id');
      const productAppSurfaceId = stringValue(raw, 'productAppSurfaceId', 'product_app_surface_id');
      const surfaceId = stringValue(raw, 'surfaceId', 'surface_id');
      return productAppId && productAppSurfaceId && surfaceId
        ? { kind: 'application_surface', productAppId, productAppSurfaceId, surfaceId }
        : null;
    }
    default:
      return null;
  }
}

function normalizeScope(rawValue: unknown): WorkScope {
  const raw = asRecord(rawValue);
  if (stringValue(raw, 'kind') === 'workspace') {
    return {
      kind: 'workspace',
      workspacePath: stringValue(raw, 'workspacePath', 'workspace_path') ?? '',
    };
  }
  return { kind: 'system' };
}

function normalizeAppRef(rawValue: unknown): WorkAppRef | null {
  const raw = asRecord(rawValue);
  const kind = stringValue(raw, 'kind') as WorkAppRef['kind'] | undefined;
  const appId = stringValue(raw, 'appId', 'app_id');
  const appVersion = stringValue(raw, 'appVersion', 'app_version');
  const componentLockDigest = stringValue(raw, 'componentLockDigest', 'component_lock_digest');
  if (kind === 'native_app') {
    return appId ? { kind, appId } : null;
  }
  if (kind !== 'product_app' || !appId || !appVersion || !componentLockDigest) return null;
  return { kind, appId, appVersion, componentLockDigest };
}

function normalizeSubject(rawValue: unknown): WorkSubject {
  const raw = asRecord(rawValue);
  if (!raw) return { kind: 'goal' };
  const kind = stringValue(raw, 'kind');
  switch (kind) {
    case 'project':
      return {
        kind: 'project',
        workspacePath: stringValue(raw, 'workspacePath', 'workspace_path') ?? '',
      };
    case 'app': {
      const app = normalizeAppRef(raw.app);
      return app
        ? {
            kind: 'app',
            app,
            intent: (stringValue(raw, 'intent') ?? 'use') as WorkAppIntent,
          }
        : { kind: 'goal' };
    }
    case 'artifact':
      return {
        kind: 'artifact',
        artifactId: stringValue(raw, 'artifactId', 'artifact_id') ?? '',
      };
    case 'goal':
    default:
      return { kind: 'goal' };
  }
}

function normalizeAppRelation(rawValue: unknown): WorkAppRelation | null {
  const raw = asRecord(rawValue);
  if (!raw) return null;
  const app = normalizeAppRef(raw.app);
  const role = stringValue(raw, 'role') as WorkAppRelation['role'] | undefined;
  if (!app || !role) return null;
  return {
    app,
    role,
    surfaceId: stringValue(raw, 'surfaceId', 'surface_id') ?? null,
  };
}

function normalizeAppRelations(rawValue: unknown): WorkAppRelation[] {
  if (!Array.isArray(rawValue)) return [];
  return rawValue
    .map(normalizeAppRelation)
    .filter((relation): relation is WorkAppRelation => !!relation);
}

function normalizeAssignment(rawValue: unknown): WorkAssignmentRef | null {
  const raw = asRecord(rawValue);
  const kind = stringValue(raw, 'kind');
  if (!kind) return null;

  switch (kind) {
    case 'agent':
      return {
        kind: 'agent',
        agentType: stringValue(raw, 'agentType', 'agent_type'),
      };
    case 'assistant':
      return {
        kind: 'assistant',
        assistantId: stringValue(raw, 'assistantId', 'assistant_id'),
      };
    case 'application':
      return {
        kind: 'application',
        applicationId: stringValue(raw, 'applicationId', 'application_id'),
      };
    case 'human':
      return {
        kind: 'human',
        humanLabel: stringValue(raw, 'humanLabel', 'human_label'),
      };
    case 'external':
      return {
        kind: 'external',
        externalLabel: stringValue(raw, 'externalLabel', 'external_label'),
      };
    default:
      return null;
  }
}

function normalizeWorkRecord(rawValue: unknown, fallbackWorkId?: string): WorkRecord | null {
  const raw = asRecord(rawValue);
  if (!raw) return null;

  const id = stringValue(raw, 'id') ?? fallbackWorkId;
  if (!id) return null;

  const fallbackSurface: WorkSurfaceRef = { kind: 'work_center', workId: id };
  const primarySurface =
    normalizeSurface(raw.primarySurface ?? raw.primary_surface, id) ??
    fallbackSurface;
  const rawSurfaces = Array.isArray(raw.surfaces) ? raw.surfaces : [];
  const surfaces = rawSurfaces
    .map(surface => normalizeSurface(surface, id))
    .filter((surface): surface is WorkSurfaceRef => !!surface);
  if (!surfaces.some(surface => JSON.stringify(surface) === JSON.stringify(primarySurface))) {
    surfaces.unshift(primarySurface);
  }

  return {
    id,
    kind: (stringValue(raw, 'kind') ?? 'delegated_work') as WorkRecord['kind'],
    title: stringValue(raw, 'title') ?? '',
    titleState: raw.titleState ?? raw.title_state,
    objective: stringValue(raw, 'objective') ?? '',
    status: (stringValue(raw, 'status') ?? 'active') as WorkRecord['status'],
    visibility: (stringValue(raw, 'visibility') ?? 'primary') as WorkRecord['visibility'],
    subject: normalizeSubject(raw.subject),
    appRefs: normalizeAppRelations(raw.appRefs ?? raw.app_refs),
    scope: normalizeScope(raw.scope),
    primarySurface,
    surfaces,
    assignment: normalizeAssignment(raw.assignment),
    lifecycle: raw.lifecycle ?? { events: [] },
    summary: raw.summary ?? null,
    sessionRefs: raw.sessionRefs ?? raw.session_refs ?? [],
    executionBindings: raw.executionBindings ?? raw.execution_bindings ?? [],
    runtimeInstances: raw.runtimeInstances ?? raw.runtime_instances ?? [],
    artifactRefs: raw.artifactRefs ?? raw.artifact_refs ?? [],
    memoryRefs: raw.memoryRefs ?? raw.memory_refs ?? [],
    createdAt: numberValue(raw, 'createdAt', 'created_at') ?? Date.now(),
    updatedAt: numberValue(raw, 'updatedAt', 'updated_at') ?? Date.now(),
  };
}

function getExecutorLabel(work: WorkRecord | null, input: WorkToolInput): string | undefined {
  if (work?.assignment?.kind === 'agent') {
    return work.assignment.agentType;
  }
  if (work?.assignment?.kind === 'assistant') {
    return work.assignment.assistantId;
  }
  if (work?.assignment?.kind === 'application') {
    return work.assignment.applicationId;
  }
  if (work?.assignment?.kind === 'human') {
    return work.assignment.humanLabel;
  }
  if (work?.assignment?.kind === 'external') {
    return work.assignment.externalLabel;
  }

  const executor = asRecord(input.executor);
  return stringValue(executor, 'agentType', 'agent_type', 'assistantId', 'assistant_id');
}

function getWorkspaceLabel(work: WorkRecord | null, input: WorkToolInput): string | undefined {
  if (work?.scope.kind === 'workspace') {
    return work.scope.workspacePath;
  }
  const inputScope = normalizeScope(input.scope);
  if (inputScope.kind === 'workspace') {
    return inputScope.workspacePath;
  }
  return undefined;
}

function getSurfaceLabel(t: Translate, surface: WorkSurfaceRef | null): string | undefined {
  if (!surface) return undefined;
  return t(`toolCards.work.surface.${surface.kind}`, { defaultValue: surface.kind });
}

function getStatusLabel(t: Translate, status?: string): string | undefined {
  if (!status) return undefined;
  return t(`toolCards.work.status.${status}`, { defaultValue: status });
}

function renderStatusPill(label: string | undefined): React.ReactNode {
  return label ? <span className="work-tool-card__status-pill">{label}</span> : undefined;
}

function renderDetailTable(rows: WorkDetailTableRow[]): React.ReactNode {
  const visibleRows = rows.filter(row => !row.hidden && row.value !== undefined && row.value !== null && row.value !== '');
  if (visibleRows.length === 0) return null;

  return (
    <div className="work-tool-card__table-wrap">
      <table className="work-tool-card__table work-tool-card__detail-table">
        <tbody>
          {visibleRows.map((row, index) => (
            <tr key={index}>
              <th scope="row">{row.label}</th>
              <td className={row.className}>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function getHeaderLine(
  t: Translate,
  phase: ReturnType<typeof getToolViewState>['phase'],
  action: string,
  title: string,
  workCount: number,
): string {
  if (phase === 'cancelled') {
    return t('toolCards.work.cancelled');
  }
  if (phase === 'interrupted') {
    return t('toolCards.work.interrupted');
  }
  if (phase === 'error') {
    return t('toolCards.work.failed');
  }

  if (action === 'status' && workCount > 0) {
    return t('toolCards.work.listedWorks', { count: workCount });
  }

  if (phase === 'running' || phase === 'receiving_input' || phase === 'preparing' || phase === 'ready') {
    if (action === 'continue') return t('toolCards.work.continuing', { title });
    if (action === 'control') return t('toolCards.work.controlling', { title });
    if (action === 'status') return t('toolCards.work.checking');
    return t('toolCards.work.creating', { title });
  }

  if (action === 'continue') return t('toolCards.work.continued', { title });
  if (action === 'control') return t('toolCards.work.controlled', { title });
  if (action === 'status') return t('toolCards.work.checked', { title });
  return t('toolCards.work.started', { title });
}

export const WorkToolCard: React.FC<ToolCardProps> = React.memo(({ toolItem }) => {
  const { t } = useTranslation('flow-chat');
  const { toolCall, toolResult, status } = toolItem;
  const viewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
  const toolId = toolItem.id ?? toolCall?.id;

  const inputData = useMemo(
    () => parseData<WorkToolInput>(toolCall?.input) ?? {},
    [toolCall?.input],
  );
  const resultData = useMemo(
    () => parseData<WorkToolResult>(toolResult?.result) ?? {},
    [toolResult?.result],
  );

  const action = resultData.action ?? inputData.action ?? 'start';
  const workId = resultData.work_id ?? inputData.work_id;
  const work = useMemo(
    () => normalizeWorkRecord(resultData.work, workId),
    [resultData.work, workId],
  );
  const title =
    work?.title ||
    inputData.title ||
    inputData.objective ||
    resultData.work_id ||
    inputData.work_id ||
    t('toolCards.work.untitled');
  const objective = work?.objective || inputData.objective;
  const effectiveStatus = resultData.status ?? work?.status;
  const statusLabel = getStatusLabel(t, effectiveStatus);
  const workspace = getWorkspaceLabel(work, inputData);
  const owner = getExecutorLabel(work, inputData) ?? t('toolCards.work.ownerDefault');
  const surfaceLabel = getSurfaceLabel(t, work?.primarySurface ?? null);
  const works = useMemo(
    () => Array.isArray(resultData.works) ? resultData.works : [],
    [resultData.works],
  );
  const listedWorks = useMemo(
    () => works
      .map(rawWork => normalizeWorkRecord(rawWork))
      .filter((candidate): candidate is WorkRecord => !!candidate),
    [works],
  );
  const workCount = listedWorks.length || works.length;
  const canOpen = Boolean(work?.id || workId);

  const handleOpen = useCallback(() => {
    void (async () => {
      try {
        if (work) {
          await openWork(work);
          return;
        }
        if (workId) {
          openWorkInCenter(workId);
        }
      } catch (error) {
        log.warn('Failed to open Work from tool card', { workId: work?.id ?? workId, error });
      }
    })();
  }, [work, workId]);

  const headerStatusIcon = useMemo(() => {
    switch (viewState.phase) {
      case 'running':
      case 'receiving_input':
      case 'preparing':
      case 'ready':
        return <DotMatrixLoader size="tiny" className="work-tool-card__loader" />;
      case 'result':
        return <Check size={12} className="work-tool-card__done-icon" />;
      case 'cancelled':
      case 'interrupted':
      case 'error':
        return <X size={12} />;
      default:
        return <Clock size={12} />;
    }
  }, [viewState.phase]);

  const hasScopedWorkContext = Boolean(
    work ||
    workId ||
    inputData.title ||
    inputData.objective ||
    inputData.scope ||
    inputData.executor,
  );
  const detailRows: WorkDetailTableRow[] = [
    {
      label: t('toolCards.work.title'),
      value: title,
      hidden: !work?.title && !inputData.title,
    },
    { label: t('toolCards.work.detail.objective'), value: objective },
    {
      label: t('toolCards.work.detail.owner'),
      value: owner,
      hidden: !hasScopedWorkContext,
    },
    {
      label: t('toolCards.work.detail.workspace'),
      value: workspace ?? t('toolCards.work.globalWorkspace'),
      hidden: !hasScopedWorkContext,
      className: 'work-tool-card__path-cell',
    },
    {
      label: t('toolCards.work.detail.surface'),
      value: surfaceLabel,
      hidden: !surfaceLabel,
    },
    {
      label: t('toolCards.work.detail.status'),
      value: renderStatusPill(statusLabel),
      hidden: !statusLabel,
    },
    {
      label: t('toolCards.work.detail.workId'),
      value: work?.id || workId ? <span className="work-tool-card__mono">{work?.id ?? workId}</span> : undefined,
      className: 'work-tool-card__path-cell',
    },
    {
      label: t('toolCards.work.detail.controlAction'),
      value: inputData.control_action,
      hidden: action !== 'control',
    },
  ];
  const hasDetailRows = detailRows.some(row => !row.hidden && row.value !== undefined && row.value !== null && row.value !== '');

  const expandedContent = (
    <div className="work-tool-card__expanded">
      {listedWorks.length > 0 ? (
        <div className="work-tool-card__table-wrap work-tool-card__table-wrap--wide">
          <table className="work-tool-card__table work-tool-card__list-table">
            <thead>
              <tr>
                <th scope="col">{t('toolCards.work.title')}</th>
                <th scope="col">{t('toolCards.work.detail.status')}</th>
                <th scope="col">{t('toolCards.work.detail.owner')}</th>
                <th scope="col">{t('toolCards.work.detail.workspace')}</th>
                <th scope="col">{t('toolCards.work.detail.surface')}</th>
              </tr>
            </thead>
            <tbody>
              {listedWorks.map(item => {
                const itemTitle = item.title || item.id;
                const itemStatus = getStatusLabel(t, item.status);
                const itemOwner = getExecutorLabel(item, inputData) ?? t('toolCards.work.ownerDefault');
                const itemWorkspace = item.scope.kind === 'workspace'
                  ? item.scope.workspacePath
                  : t('toolCards.work.globalWorkspace');
                const itemSurface = getSurfaceLabel(t, item.primarySurface);

                return (
                  <tr key={item.id}>
                    <td>
                      <span className="work-tool-card__work-cell">
                        <span className="work-tool-card__work-title" title={itemTitle}>
                          {itemTitle}
                        </span>
                        {item.objective && (
                          <span className="work-tool-card__work-objective" title={item.objective}>
                            {item.objective}
                          </span>
                        )}
                        <span className="work-tool-card__mono work-tool-card__work-id">
                          {item.id}
                        </span>
                      </span>
                    </td>
                    <td>{renderStatusPill(itemStatus)}</td>
                    <td title={itemOwner}>{itemOwner}</td>
                    <td className="work-tool-card__path-cell" title={itemWorkspace}>
                      {itemWorkspace}
                    </td>
                    <td>{itemSurface}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : renderDetailTable(detailRows)}
      {toolResult?.error && (
        <div className="work-tool-card__error">
          <ToolErrorBlock message={toolResult.error} />
        </div>
      )}
    </div>
  );

  const hasExpandedContent = Boolean(
    hasDetailRows ||
    listedWorks.length > 0 ||
    toolResult?.error,
  );

  return (
    <DefaultToolCardTemplate
      toolId={toolId}
      toolName={toolItem.toolName}
      status={status}
      className="work-tool-card"
      statusIcon={headerStatusIcon}
      action={`${t('toolCards.work.title')}:`}
      summary={getHeaderLine(t, viewState.phase, action, title, workCount)}
      extra={
        statusLabel
          ? <span className="work-tool-card__status">{statusLabel}</span>
          : undefined
      }
      primaryAction={
        canOpen
          ? {
            icon: <ExternalLink size={12} />,
            label: t('toolCards.work.open'),
            onClick: handleOpen,
            visibility: 'always',
          }
          : undefined
      }
      expandedContent={hasExpandedContent ? expandedContent : undefined}
    />
  );
});

WorkToolCard.displayName = 'WorkToolCard';
