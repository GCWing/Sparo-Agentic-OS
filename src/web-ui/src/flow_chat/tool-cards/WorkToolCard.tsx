import React, { useCallback, useMemo } from 'react';
import { Check, Clock, ExternalLink, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DotMatrixLoader } from '@/design-system';
import { openWork, openWorkInCenter } from '@/app/agentic-os/work/navigation/openWork';
import type {
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
import { ToolJsonPreview } from './ToolJsonPreview';
import { ToolStructuredDetails } from './ToolStructuredDetails';
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
        dispatcherSessionId: stringValue(raw, 'dispatcherSessionId', 'dispatcher_session_id') ?? null,
      };
    case 'work_session': {
      const sessionId = stringValue(raw, 'sessionId', 'session_id');
      return sessionId ? { kind: 'work_session', sessionId } : null;
    }
    case 'agent_session': {
      const sessionId = stringValue(raw, 'sessionId', 'session_id');
      return sessionId ? { kind: 'agent_session', sessionId } : null;
    }
    case 'live_app': {
      const appId = stringValue(raw, 'appId', 'app_id');
      return appId ? { kind: 'live_app', appId } : null;
    }
    case 'work_center':
      return {
        kind: 'work_center',
        workId: stringValue(raw, 'workId', 'work_id') ?? fallbackWorkId,
      };
    case 'application_surface': {
      const applicationId = stringValue(raw, 'applicationId', 'application_id');
      const surfaceId = stringValue(raw, 'surfaceId', 'surface_id');
      return applicationId && surfaceId
        ? { kind: 'application_surface', applicationId, surfaceId }
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
    scope: normalizeScope(raw.scope),
    primarySurface,
    surfaces,
    assignment: normalizeAssignment(raw.assignment),
    lifecycle: raw.lifecycle ?? { events: [] },
    summary: raw.summary ?? null,
    sessionRefs: raw.sessionRefs ?? raw.session_refs ?? [],
    executionBindings: raw.executionBindings ?? raw.execution_bindings ?? [],
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
  const works = Array.isArray(resultData.works) ? resultData.works : [];
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

  const expandedContent = (
    <ToolStructuredDetails
      className="work-tool-card__details"
      rows={[
        { label: t('toolCards.work.detail.objective'), value: objective },
        { label: t('toolCards.work.detail.owner'), value: owner },
        { label: t('toolCards.work.detail.workspace'), value: workspace ?? t('toolCards.work.globalWorkspace') },
        { label: t('toolCards.work.detail.surface'), value: surfaceLabel },
        {
          label: t('toolCards.work.detail.status'),
          value: statusLabel,
          hidden: !statusLabel,
        },
        {
          label: t('toolCards.work.detail.workId'),
          value: work?.id || workId ? <span className="work-tool-card__mono">{work?.id ?? workId}</span> : undefined,
        },
        {
          label: t('toolCards.work.detail.controlAction'),
          value: inputData.control_action,
          hidden: action !== 'control',
        },
      ]}
    >
      {works.length > 0 && (
        <ToolJsonPreview
          className="work-tool-card__json"
          value={works}
          maxChars={1800}
        />
      )}
      {toolResult?.error && <ToolErrorBlock message={toolResult.error} />}
    </ToolStructuredDetails>
  );

  const hasExpandedContent = Boolean(
    objective ||
    workspace ||
    surfaceLabel ||
    statusLabel ||
    work?.id ||
    workId ||
    works.length > 0 ||
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
      summary={getHeaderLine(t, viewState.phase, action, title, works.length)}
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
