import React, { useCallback, useMemo } from 'react';
import {
  ChevronRight,
  FileCode2,
  ListChecks,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  TestTube,
  Wrench,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SparoAgentIcon } from '@/design-system';
import type { ToolCardProps } from '../types/flow-chat';
import {
  DefaultToolCardTemplate,
  HeavyToolCardTemplate,
  renderHeavyToolRunningStatus,
} from './templates';
import { deriveToolRuntimeState } from '../runtime/statusModel';
import { getToolViewState } from '../runtime/toolViewState';
import { appScopeIdentity } from '@/shared/types/app-scope';
import { resolveToolSessionAppScope } from './surfaceComponentToolScope';
import './ComponentStudioToolDisplay.scss';

const EMPTY_TOOL_RESULT: Record<string, unknown> = {};

interface ToolLabelEntry {
  icon: React.ReactNode;
  tagKey: string;
  layout: 'compact' | 'standard';
  /** Whether to show the "open in Apps" affordance (mutating apps tools). */
  openable?: boolean;
}

const TOOL_LABELS: Record<string, ToolLabelEntry> = {
  ListAgentComponents: {
    icon: <ListChecks size={16} />,
    tagKey: 'list',
    layout: 'compact',
  },
  CreateComponentPackage: {
    icon: <Plus size={16} />,
    tagKey: 'createPackage',
    layout: 'standard',
  },
  GetAgentComponent: {
    icon: <Search size={16} />,
    tagKey: 'inspect',
    layout: 'compact',
  },
  ValidateAgentComponentPackage: {
    icon: <ShieldCheck size={16} />,
    tagKey: 'validate',
    layout: 'compact',
  },
  CreateAgentComponent: {
    icon: <Plus size={16} />,
    tagKey: 'create',
    layout: 'standard',
    openable: true,
  },
  UpdateAgentComponent: {
    icon: <Pencil size={16} />,
    tagKey: 'update',
    layout: 'standard',
    openable: true,
  },
  ListAgentComponentToolOptions: {
    icon: <Wrench size={16} />,
    tagKey: 'tools',
    layout: 'compact',
  },
  CreateAgentComponentJsTool: {
    icon: <FileCode2 size={16} />,
    tagKey: 'jsTool',
    layout: 'standard',
  },
  TestAgentComponentJsTool: {
    icon: <TestTube size={16} />,
    tagKey: 'testJsTool',
    layout: 'compact',
  },
};

interface AppRow {
  id?: string;
  name?: string;
  description?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function pickManifest(result: Record<string, unknown>): Record<string, unknown> | undefined {
  return asRecord(result.manifest) ?? asRecord(result);
}

function describeChip(label: string, value?: string | number | boolean | null): string | null {
  if (value === undefined || value === null || value === '') return null;
  return `${label}: ${value}`;
}

export const ComponentStudioToolDisplay: React.FC<ToolCardProps> = ({ toolItem, sessionId }) => {
  const { t } = useTranslation('flow-chat');
  const { status, toolResult, toolCall } = toolItem;
  const runtimeState = useMemo(() => deriveToolRuntimeState(toolItem), [toolItem]);
  const viewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
  const toolName = toolItem.toolName;
  const label = TOOL_LABELS[toolName] ?? {
    icon: <SparoAgentIcon size={16} />,
    tagKey: 'generic',
    layout: 'compact',
  };

  const result = (toolResult?.result ?? EMPTY_TOOL_RESULT) as Record<string, unknown>;
  const input = (runtimeState.inputPhase === 'streaming' ? runtimeState.partialInput : runtimeState.input) as Record<string, unknown> | undefined;
  const isCompleted = viewState.phase === 'result';
  const isToolRunning = viewState.phase === 'preparing' || viewState.phase === 'receiving_input' || viewState.phase === 'running';
  const isFailed =
    viewState.phase === 'error' || (isCompleted && toolResult != null && toolResult.success === false);

  const actionLabel = t('toolCards.componentStudio.title');
  const tagLabel = t(`toolCards.componentStudio.${label.tagKey}`, { defaultValue: toolName });

  // Build summary text per tool.
  const summary = useMemo(() => {
    if (toolName === 'ListAgentComponents') {
      const apps = Array.isArray(result.apps) ? result.apps : [];
      if (!isCompleted) return t('toolCards.componentStudio.scanning');
      return t('toolCards.componentStudio.appsCount', { count: apps.length });
    }
    if (toolName === 'GetAgentComponent') {
      const manifest = pickManifest(result);
      const name = (manifest?.name as string | undefined) ?? (input?.id as string | undefined);
      return name ?? t('toolCards.componentStudio.loading');
    }
    if (toolName === 'ValidateAgentComponentPackage') {
      if (!isCompleted) return t('toolCards.componentStudio.validating');
      const ok = result.ok !== false;
      return ok ? t('toolCards.componentStudio.validOk') : t('toolCards.componentStudio.validFailed');
    }
    if (toolName === 'CreateComponentPackage') {
      const id =
        (result.component_id as string | undefined) ??
        (result.componentId as string | undefined) ??
        (input?.component_id as string | undefined) ??
        (input?.componentId as string | undefined);
      const kind = (result.kind as string | undefined) ?? (input?.kind as string | undefined);
      const base = id || (input?.name as string | undefined) || t('toolCards.componentStudio.unnamed');
      return kind ? `${base} · ${kind}` : base;
    }
    if (toolName === 'CreateAgentComponent' || toolName === 'UpdateAgentComponent') {
      const manifest = pickManifest(result);
      const name = (manifest?.name as string | undefined) ?? (input?.name as string | undefined);
      const tools = Array.isArray(manifest?.tools)
        ? (manifest!.tools as unknown[]).length
        : Array.isArray(input?.tools)
          ? (input!.tools as unknown[]).length
          : undefined;
      const base = name || t('toolCards.componentStudio.unnamed');
      return tools !== undefined
        ? `${base} · ${t('toolCards.componentStudio.toolsCount', { count: tools })}`
        : base;
    }
    if (toolName === 'ListAgentComponentToolOptions') {
      const tools = Array.isArray(result.tools) ? (result.tools as unknown[]).length : 0;
      if (!isCompleted) return t('toolCards.componentStudio.scanning');
      return t('toolCards.componentStudio.toolsCount', { count: tools });
    }
    if (toolName === 'CreateAgentComponentJsTool') {
      const created = (result.toolName as string | undefined) ?? (input?.componentId as string | undefined);
      return created ?? t('toolCards.componentStudio.creatingJsTool');
    }
    if (toolName === 'TestAgentComponentJsTool') {
      const tested = (input?.toolName as string | undefined) ?? '';
      if (!isCompleted) {
        return tested
          ? t('toolCards.componentStudio.testingNamed', { name: tested })
          : t('toolCards.componentStudio.testing');
      }
      const ok = result.success !== false;
      return tested
        ? `${tested} · ${ok ? t('toolCards.componentStudio.testPass') : t('toolCards.componentStudio.testFail')}`
        : ok
          ? t('toolCards.componentStudio.testPass')
          : t('toolCards.componentStudio.testFail');
    }
    return toolName;
  }, [toolName, result, input, isCompleted, t]);

  // Chips: small structured tags shown next to the summary in expanded/standard mode.
  const chips = useMemo<string[]>(() => {
    const out: string[] = [];
    if (toolName === 'CreateAgentComponent' || toolName === 'UpdateAgentComponent' || toolName === 'GetAgentComponent') {
      const manifest = pickManifest(result) ?? input ?? {};
      const id = describeChip('id', manifest.id as string | undefined);
      const model = describeChip(
        t('toolCards.componentStudio.fieldModel'),
        manifest.model as string | undefined,
      );
      const cat = describeChip(
        t('toolCards.componentStudio.fieldCategory'),
        manifest.category as string | undefined,
      );
      const ro = manifest.readonly === true ? t('toolCards.componentStudio.readonly') : null;
      [id, model, cat, ro].forEach((chip) => {
        if (chip) out.push(chip);
      });
    }
    if (toolName === 'CreateAgentComponentJsTool') {
      const componentId = describeChip('componentId', input?.componentId as string | undefined);
      if (componentId) out.push(componentId);
    }
    if (toolName === 'CreateComponentPackage') {
      const kind = describeChip(
        t('toolCards.componentStudio.fieldKind', { defaultValue: 'kind' }),
        (result.kind as string | undefined) ?? (input?.kind as string | undefined),
      );
      const version = describeChip(
        t('toolCards.componentStudio.fieldVersion', { defaultValue: 'version' }),
        (result.version as string | undefined) ?? (input?.version as string | undefined),
      );
      [kind, version].forEach((chip) => {
        if (chip) out.push(chip);
      });
    }
    return out;
  }, [toolName, result, input, t]);

  // Expanded body: detailed list / per-tool layouts.
  const expandedBody = useMemo<React.ReactNode>(() => {
    if (toolName === 'ListAgentComponents') {
      const apps = Array.isArray(result.apps) ? (result.apps as AppRow[]) : [];
      if (apps.length === 0) return null;
      return (
        <div className="component-studio-list-details">
          {apps.slice(0, 24).map((app, idx) => (
            <div className="component-studio-app-row" key={`${app.id ?? idx}`}>
              <span className="name" title={app.name ?? app.id}>{app.name ?? app.id ?? '—'}</span>
              <span className="desc" title={app.description ?? ''}>{app.description ?? ''}</span>
              <span className="id" title={app.id ?? ''}>{app.id ?? ''}</span>
            </div>
          ))}
          {apps.length > 24 ? (
            <div className="component-studio-tool-row">
              <span className="component-studio-tool-label">…</span>
              <span className="component-studio-tool-value">
                {t('toolCards.componentStudio.moreApps', { count: apps.length - 24 })}
              </span>
            </div>
          ) : null}
        </div>
      );
    }
    if (toolName === 'ListAgentComponentToolOptions') {
      const tools = Array.isArray(result.tools) ? (result.tools as string[]) : [];
      if (tools.length === 0) return null;
      return (
        <div className="component-studio-tools-details">
          <div className="component-studio-chip-row">
            {tools.slice(0, 80).map((tool) => (
              <span className="component-studio-chip" key={tool}>{tool}</span>
            ))}
          </div>
          {tools.length > 80 ? (
            <div className="component-studio-tool-row">
              <span className="component-studio-tool-label">…</span>
              <span className="component-studio-tool-value">
                {t('toolCards.componentStudio.moreTools', { count: tools.length - 80 })}
              </span>
            </div>
          ) : null}
        </div>
      );
    }
    if (
      toolName === 'CreateComponentPackage' ||
      toolName === 'GetAgentComponent' ||
      toolName === 'CreateAgentComponent' ||
      toolName === 'UpdateAgentComponent' ||
      toolName === 'ValidateAgentComponentPackage'
    ) {
      const manifest = toolName === 'CreateComponentPackage'
        ? ({ ...input, ...result } as Record<string, unknown>)
        : pickManifest(result);
      if (!manifest) return null;
      const tools = Array.isArray(manifest.tools) ? (manifest.tools as string[]) : [];
      const tags = Array.isArray(manifest.tags) ? (manifest.tags as string[]) : [];
      const examples = Array.isArray(manifest.examples) ? (manifest.examples as unknown[]).length : 0;
      const rows: Array<[string, React.ReactNode]> = [];
      if (manifest.name) rows.push([t('toolCards.componentStudio.fieldName'), String(manifest.name)]);
      const id = manifest.id ?? manifest.component_id ?? manifest.componentId;
      if (id) rows.push(['id', String(id)]);
      if (manifest.kind)
        rows.push([t('toolCards.componentStudio.fieldKind', { defaultValue: 'kind' }), String(manifest.kind)]);
      if (manifest.version)
        rows.push([t('toolCards.componentStudio.fieldVersion', { defaultValue: 'version' }), String(manifest.version)]);
      if (manifest.description)
        rows.push([t('toolCards.componentStudio.fieldDescription'), String(manifest.description)]);
      if (manifest.model)
        rows.push([t('toolCards.componentStudio.fieldModel'), String(manifest.model)]);
      if (manifest.category)
        rows.push([t('toolCards.componentStudio.fieldCategory'), String(manifest.category)]);
      rows.push([
        t('toolCards.componentStudio.fieldReadonly'),
        manifest.readonly === true ? 'true' : 'false',
      ]);
      if (tools.length) {
        rows.push([
          t('toolCards.componentStudio.fieldTools'),
          <span className="component-studio-chip-row" key="tools-row">
            {tools.slice(0, 20).map((tool) => (
              <span className="component-studio-chip" key={tool}>{tool}</span>
            ))}
            {tools.length > 20 ? (
              <span className="component-studio-chip">+{tools.length - 20}</span>
            ) : null}
          </span>,
        ]);
      }
      if (tags.length) {
        rows.push([
          t('toolCards.componentStudio.fieldTags'),
          <span className="component-studio-chip-row" key="tags-row">
            {tags.map((tag) => (
              <span className="component-studio-chip" key={tag}>{tag}</span>
            ))}
          </span>,
        ]);
      }
      if (examples) {
        rows.push([t('toolCards.componentStudio.fieldExamples'), `${examples}`]);
      }
      if (typeof result.path === 'string') {
        rows.push([t('toolCards.componentStudio.fieldPath'), result.path]);
      }
      if (rows.length === 0) return null;
      return (
        <div className="component-studio-tool-details">
          {rows.map(([k, v]) => (
            <div key={k} className="component-studio-tool-row">
              <span className="component-studio-tool-label">{k}</span>
              <span className="component-studio-tool-value">{v}</span>
            </div>
          ))}
        </div>
      );
    }
    if (toolName === 'CreateAgentComponentJsTool') {
      const rows: Array<[string, string]> = [];
      const created = (result.toolName as string | undefined) ?? '';
      if (created) rows.push([t('toolCards.componentStudio.fieldToolName'), created]);
      if (input?.componentId) rows.push(['componentId', String(input.componentId)]);
      const manifest = asRecord(input?.manifest);
      if (manifest?.description)
        rows.push([t('toolCards.componentStudio.fieldDescription'), String(manifest.description)]);
      if (typeof manifest?.timeoutMs === 'number')
        rows.push(['timeoutMs', String(manifest.timeoutMs)]);
      if (manifest?.readonly !== undefined)
        rows.push([t('toolCards.componentStudio.fieldReadonly'), String(manifest.readonly)]);
      if (rows.length === 0) return null;
      return (
        <div className="component-studio-tool-details">
          {rows.map(([k, v]) => (
            <div key={k} className="component-studio-tool-row">
              <span className="component-studio-tool-label">{k}</span>
              <span className="component-studio-tool-value">{v}</span>
            </div>
          ))}
        </div>
      );
    }
    if (toolName === 'TestAgentComponentJsTool') {
      const rows: Array<[string, string]> = [];
      if (input?.toolName) rows.push([t('toolCards.componentStudio.fieldToolName'), String(input.toolName)]);
      if (input?.componentId) rows.push(['componentId', String(input.componentId)]);
      const summaryStr = (result.summary as string | undefined) ?? '';
      if (summaryStr) rows.push([t('toolCards.componentStudio.fieldSummary'), summaryStr]);
      const data = result.data;
      if (data !== undefined && data !== null) {
        rows.push(['data', typeof data === 'string' ? data : JSON.stringify(data)]);
      }
      if (rows.length === 0) return null;
      return (
        <div className="component-studio-tool-details">
          {rows.map(([k, v]) => (
            <div key={k} className="component-studio-tool-row">
              <span className="component-studio-tool-label">{k}</span>
              <span className="component-studio-tool-value">{v}</span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  }, [toolName, result, input, t]);

  // Resolve the component id this tool produced/touched, so we can drive the
  // right-side ComponentStudio preview panel.
  const resolvedComponentId = useMemo<string | undefined>(() => {
    const manifest = pickManifest(result);
    return (
      (manifest?.id as string | undefined) ??
      (result.id as string | undefined) ??
      (input?.id as string | undefined) ??
      (input?.componentId as string | undefined) ??
      (input?.name as string | undefined)
    );
  }, [result, input]);
  const appScope = useMemo(() => resolveToolSessionAppScope(sessionId), [sessionId]);

  const handleOpenStudioPanel = useCallback(() => {
    if (!resolvedComponentId) return;
    const duplicateCheckKey = `component-studio:${sessionId ?? `${resolvedComponentId}:${appScopeIdentity(appScope)}`}`;
    window.dispatchEvent(new CustomEvent('expand-right-panel'));
    window.dispatchEvent(new CustomEvent('agent-create-tab', {
      detail: {
        type: 'component-studio',
        title: t('toolCards.componentStudio.previewPanelTitle', { defaultValue: 'Component Studio' }),
        data: {
          sessionId: sessionId ?? null,
          componentId: resolvedComponentId,
          scope: appScope,
        },
        metadata: {
          componentStudioSessionId: sessionId,
          componentStudioComponentId: resolvedComponentId,
          appScope,
        },
        checkDuplicate: true,
        duplicateCheckKey,
        replaceExisting: true,
      },
    }));
    // Notify any mounted ComponentStudioPanel to refresh / switch app.
    window.dispatchEvent(new CustomEvent('component-updated', {
      detail: { componentId: resolvedComponentId, scope: appScope },
    }));
  }, [appScope, resolvedComponentId, sessionId, t]);

  const canOpenStudioPanel =
    label.openable === true &&
    isCompleted &&
    !isFailed &&
    Boolean(resolvedComponentId);

  // Compact layout for read-only / introspection tools.
  if (label.layout === 'compact') {
    return (
      <DefaultToolCardTemplate
        toolId={toolItem.id ?? toolCall?.id}
        toolName={toolName}
        status={status}
        action={`${actionLabel}:`}
        summary={
          <span className="component-studio-tool-info">
            <span className="operation-tag">{tagLabel}</span>
            <span className="command-text">{summary}</span>
          </span>
        }
        className="component-studio-compact"
        expandedContent={expandedBody}
      />
    );
  }

  // Standard layout for mutating / package-producing tools.
  return (
    <HeavyToolCardTemplate
      toolId={toolItem.id ?? toolCall?.id}
      toolName={toolName}
      status={status}
      isFailed={isFailed}
      className={`component-studio-tool-display${canOpenStudioPanel ? ' component-studio-tool-display--panel-only' : ''}`}
      icon={label.icon}
      title={
        <span className="component-studio-tool-info">
          <span className="operation-tag">{tagLabel}</span>
          <span className="command-text">{summary}</span>
          {chips.length > 0 ? (
            <span className="component-studio-chip-row" aria-hidden>
              {chips.slice(0, 3).map((chip) => (
                <span className="component-studio-chip" key={chip}>{chip}</span>
              ))}
            </span>
          ) : null}
        </span>
      }
      showHeaderExpandHint={!canOpenStudioPanel && Boolean(expandedBody)}
      isRunning={isToolRunning}
      headerRail={canOpenStudioPanel ? {
        label: t('toolCards.componentStudio.openStudioPanel'),
        onClick: handleOpenStudioPanel,
        icon: (
          <>
            <ChevronRight size={18} strokeWidth={2} absoluteStrokeWidth />
            <div className="task-status-icon task-status-icon--rail">
              {renderHeavyToolRunningStatus(isToolRunning)}
            </div>
          </>
        ),
      } : undefined}
      expandedContent={canOpenStudioPanel ? undefined : expandedBody}
    />
  );
};
