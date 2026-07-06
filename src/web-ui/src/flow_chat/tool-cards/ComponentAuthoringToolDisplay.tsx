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
import { resolveToolSessionAppScope } from './appBuilderToolScope';
import './ComponentAuthoringToolDisplay.scss';

const EMPTY_TOOL_RESULT: Record<string, unknown> = {};

interface ToolLabelEntry {
  icon: React.ReactNode;
  tagKey: string;
  layout: 'compact' | 'standard';
  /** Whether to show the App Builder workbench affordance for mutating component tools. */
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
    openable: true,
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

function componentKindSegment(value: unknown, fallback?: string): string | undefined {
  const raw = typeof value === 'string' && value.trim()
    ? value.trim().toLowerCase()
    : fallback;
  if (!raw) return undefined;
  switch (raw.replace(/[\s_-]/g, '')) {
    case 'surface':
    case 'surfacecomponent':
    case 'surfaces':
      return 'surfaces';
    case 'agent':
    case 'agentcomponent':
    case 'agents':
      return 'agents';
    case 'bridge':
    case 'bridgecomponent':
    case 'bridges':
      return 'bridges';
    case 'runtime':
    case 'runtimecomponent':
    case 'runtimes':
      return 'runtimes';
    case 'tool':
    case 'toolcomponent':
    case 'tools':
      return 'tools';
    case 'skill':
    case 'skillcomponent':
    case 'skills':
      return 'skills';
    default:
      return raw;
  }
}

export const ComponentAuthoringToolDisplay: React.FC<ToolCardProps> = ({ toolItem, sessionId }) => {
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

  const actionLabel = t('toolCards.componentAuthoring.title');
  const tagLabel = t(`toolCards.componentAuthoring.${label.tagKey}`, { defaultValue: toolName });

  // Build summary text per tool.
  const summary = useMemo(() => {
    if (toolName === 'ListAgentComponents') {
      const apps = Array.isArray(result.apps) ? result.apps : [];
      if (!isCompleted) return t('toolCards.componentAuthoring.scanning');
      return t('toolCards.componentAuthoring.appsCount', { count: apps.length });
    }
    if (toolName === 'GetAgentComponent') {
      const manifest = pickManifest(result);
      const name = (manifest?.name as string | undefined) ?? (input?.id as string | undefined);
      return name ?? t('toolCards.componentAuthoring.loading');
    }
    if (toolName === 'ValidateAgentComponentPackage') {
      if (!isCompleted) return t('toolCards.componentAuthoring.validating');
      const ok = result.ok !== false;
      return ok ? t('toolCards.componentAuthoring.validOk') : t('toolCards.componentAuthoring.validFailed');
    }
    if (toolName === 'CreateComponentPackage') {
      const id =
        (result.component_id as string | undefined) ??
        (result.componentId as string | undefined) ??
        (input?.component_id as string | undefined) ??
        (input?.componentId as string | undefined);
      const kind = (result.kind as string | undefined) ?? (input?.kind as string | undefined);
      const base = id || (input?.name as string | undefined) || t('toolCards.componentAuthoring.unnamed');
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
      const base = name || t('toolCards.componentAuthoring.unnamed');
      return tools !== undefined
        ? `${base} · ${t('toolCards.componentAuthoring.toolsCount', { count: tools })}`
        : base;
    }
    if (toolName === 'ListAgentComponentToolOptions') {
      const tools = Array.isArray(result.tools) ? (result.tools as unknown[]).length : 0;
      if (!isCompleted) return t('toolCards.componentAuthoring.scanning');
      return t('toolCards.componentAuthoring.toolsCount', { count: tools });
    }
    if (toolName === 'CreateAgentComponentJsTool') {
      const created = (result.toolName as string | undefined) ?? (input?.componentId as string | undefined);
      return created ?? t('toolCards.componentAuthoring.creatingJsTool');
    }
    if (toolName === 'TestAgentComponentJsTool') {
      const tested = (input?.toolName as string | undefined) ?? '';
      if (!isCompleted) {
        return tested
          ? t('toolCards.componentAuthoring.testingNamed', { name: tested })
          : t('toolCards.componentAuthoring.testing');
      }
      const ok = result.success !== false;
      return tested
        ? `${tested} · ${ok ? t('toolCards.componentAuthoring.testPass') : t('toolCards.componentAuthoring.testFail')}`
        : ok
          ? t('toolCards.componentAuthoring.testPass')
          : t('toolCards.componentAuthoring.testFail');
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
        t('toolCards.componentAuthoring.fieldModel'),
        manifest.model as string | undefined,
      );
      const cat = describeChip(
        t('toolCards.componentAuthoring.fieldCategory'),
        manifest.category as string | undefined,
      );
      const ro = manifest.readonly === true ? t('toolCards.componentAuthoring.readonly') : null;
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
        t('toolCards.componentAuthoring.fieldKind', { defaultValue: 'kind' }),
        (result.kind as string | undefined) ?? (input?.kind as string | undefined),
      );
      const version = describeChip(
        t('toolCards.componentAuthoring.fieldVersion', { defaultValue: 'version' }),
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
        <div className="component-authoring-list-details">
          {apps.slice(0, 24).map((app, idx) => (
            <div className="component-authoring-app-row" key={`${app.id ?? idx}`}>
              <span className="name" title={app.name ?? app.id}>{app.name ?? app.id ?? '—'}</span>
              <span className="desc" title={app.description ?? ''}>{app.description ?? ''}</span>
              <span className="id" title={app.id ?? ''}>{app.id ?? ''}</span>
            </div>
          ))}
          {apps.length > 24 ? (
            <div className="component-authoring-tool-row">
              <span className="component-authoring-tool-label">…</span>
              <span className="component-authoring-tool-value">
                {t('toolCards.componentAuthoring.moreApps', { count: apps.length - 24 })}
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
        <div className="component-authoring-tools-details">
          <div className="component-authoring-chip-row">
            {tools.slice(0, 80).map((tool) => (
              <span className="component-authoring-chip" key={tool}>{tool}</span>
            ))}
          </div>
          {tools.length > 80 ? (
            <div className="component-authoring-tool-row">
              <span className="component-authoring-tool-label">…</span>
              <span className="component-authoring-tool-value">
                {t('toolCards.componentAuthoring.moreTools', { count: tools.length - 80 })}
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
      if (manifest.name) rows.push([t('toolCards.componentAuthoring.fieldName'), String(manifest.name)]);
      const id = manifest.id ?? manifest.component_id ?? manifest.componentId;
      if (id) rows.push(['id', String(id)]);
      if (manifest.kind)
        rows.push([t('toolCards.componentAuthoring.fieldKind', { defaultValue: 'kind' }), String(manifest.kind)]);
      if (manifest.version)
        rows.push([t('toolCards.componentAuthoring.fieldVersion', { defaultValue: 'version' }), String(manifest.version)]);
      if (manifest.description)
        rows.push([t('toolCards.componentAuthoring.fieldDescription'), String(manifest.description)]);
      if (manifest.model)
        rows.push([t('toolCards.componentAuthoring.fieldModel'), String(manifest.model)]);
      if (manifest.category)
        rows.push([t('toolCards.componentAuthoring.fieldCategory'), String(manifest.category)]);
      rows.push([
        t('toolCards.componentAuthoring.fieldReadonly'),
        manifest.readonly === true ? 'true' : 'false',
      ]);
      if (tools.length) {
        rows.push([
          t('toolCards.componentAuthoring.fieldTools'),
          <span className="component-authoring-chip-row" key="tools-row">
            {tools.slice(0, 20).map((tool) => (
              <span className="component-authoring-chip" key={tool}>{tool}</span>
            ))}
            {tools.length > 20 ? (
              <span className="component-authoring-chip">+{tools.length - 20}</span>
            ) : null}
          </span>,
        ]);
      }
      if (tags.length) {
        rows.push([
          t('toolCards.componentAuthoring.fieldTags'),
          <span className="component-authoring-chip-row" key="tags-row">
            {tags.map((tag) => (
              <span className="component-authoring-chip" key={tag}>{tag}</span>
            ))}
          </span>,
        ]);
      }
      if (examples) {
        rows.push([t('toolCards.componentAuthoring.fieldExamples'), `${examples}`]);
      }
      if (typeof result.path === 'string') {
        rows.push([t('toolCards.componentAuthoring.fieldPath'), result.path]);
      }
      if (rows.length === 0) return null;
      return (
        <div className="component-authoring-tool-details">
          {rows.map(([k, v]) => (
            <div key={k} className="component-authoring-tool-row">
              <span className="component-authoring-tool-label">{k}</span>
              <span className="component-authoring-tool-value">{v}</span>
            </div>
          ))}
        </div>
      );
    }
    if (toolName === 'CreateAgentComponentJsTool') {
      const rows: Array<[string, string]> = [];
      const created = (result.toolName as string | undefined) ?? '';
      if (created) rows.push([t('toolCards.componentAuthoring.fieldToolName'), created]);
      if (input?.componentId) rows.push(['componentId', String(input.componentId)]);
      const manifest = asRecord(input?.manifest);
      if (manifest?.description)
        rows.push([t('toolCards.componentAuthoring.fieldDescription'), String(manifest.description)]);
      if (typeof manifest?.timeoutMs === 'number')
        rows.push(['timeoutMs', String(manifest.timeoutMs)]);
      if (manifest?.readonly !== undefined)
        rows.push([t('toolCards.componentAuthoring.fieldReadonly'), String(manifest.readonly)]);
      if (rows.length === 0) return null;
      return (
        <div className="component-authoring-tool-details">
          {rows.map(([k, v]) => (
            <div key={k} className="component-authoring-tool-row">
              <span className="component-authoring-tool-label">{k}</span>
              <span className="component-authoring-tool-value">{v}</span>
            </div>
          ))}
        </div>
      );
    }
    if (toolName === 'TestAgentComponentJsTool') {
      const rows: Array<[string, string]> = [];
      if (input?.toolName) rows.push([t('toolCards.componentAuthoring.fieldToolName'), String(input.toolName)]);
      if (input?.componentId) rows.push(['componentId', String(input.componentId)]);
      const summaryStr = (result.summary as string | undefined) ?? '';
      if (summaryStr) rows.push([t('toolCards.componentAuthoring.fieldSummary'), summaryStr]);
      const data = result.data;
      if (data !== undefined && data !== null) {
        rows.push(['data', typeof data === 'string' ? data : JSON.stringify(data)]);
      }
      if (rows.length === 0) return null;
      return (
        <div className="component-authoring-tool-details">
          {rows.map(([k, v]) => (
            <div key={k} className="component-authoring-tool-row">
              <span className="component-authoring-tool-label">{k}</span>
              <span className="component-authoring-tool-value">{v}</span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  }, [toolName, result, input, t]);

  // Resolve the component id this tool produced/touched, so App Builder can
  // project the component authoring fact into the right-side workbench.
  const resolvedComponentId = useMemo<string | undefined>(() => {
    const manifest = pickManifest(result);
    return (
      (manifest?.id as string | undefined) ??
      (manifest?.component_id as string | undefined) ??
      (manifest?.componentId as string | undefined) ??
      (result.id as string | undefined) ??
      (result.component_id as string | undefined) ??
      (result.componentId as string | undefined) ??
      (input?.id as string | undefined) ??
      (input?.component_id as string | undefined) ??
      (input?.componentId as string | undefined) ??
      (input?.name as string | undefined)
    );
  }, [result, input]);
  const resolvedComponentKind = useMemo<string | undefined>(() => {
    const manifest = pickManifest(result);
    return componentKindSegment(
      (result.componentKind as string | undefined) ??
      (result.component_kind as string | undefined) ??
      (manifest?.componentKind as string | undefined) ??
      (manifest?.component_kind as string | undefined) ??
      (result.kind as string | undefined) ??
      (manifest?.kind as string | undefined) ??
      (input?.kind as string | undefined),
      toolName.includes('AgentComponent') ? 'agents' : undefined,
    );
  }, [input, result, toolName]);
  const resolvedComponentVersion = useMemo<string | undefined>(() => {
    const manifest = pickManifest(result);
    return (
      (result.version as string | undefined) ??
      (manifest?.version as string | undefined) ??
      (input?.version as string | undefined)
    );
  }, [input, result]);
  const resolvedComponentPackageRoot = useMemo<string | undefined>(() => {
    return (
      (result.packageRoot as string | undefined) ??
      (result.package_root as string | undefined) ??
      (result.path as string | undefined)
    );
  }, [result]);
  const resolvedComponentName = useMemo<string | undefined>(() => {
    const manifest = pickManifest(result);
    return (
      (result.name as string | undefined) ??
      (manifest?.name as string | undefined) ??
      (input?.name as string | undefined) ??
      resolvedComponentId
    );
  }, [input, resolvedComponentId, result]);
  const resolvedComponentDescription = useMemo<string | undefined>(() => {
    const manifest = pickManifest(result);
    return (
      (result.description as string | undefined) ??
      (manifest?.description as string | undefined) ??
      (input?.description as string | undefined)
    );
  }, [input, result]);
  const appScope = useMemo(() => resolveToolSessionAppScope(sessionId), [sessionId]);

  const handleOpenBuilderPanel = useCallback(() => {
    if (!resolvedComponentId || !resolvedComponentKind) return;
    const duplicateCheckKey = `app-builder:component:${sessionId ?? `${resolvedComponentId}:${appScopeIdentity(appScope)}`}`;
    window.dispatchEvent(new CustomEvent('expand-right-panel'));
    window.dispatchEvent(new CustomEvent('agent-create-tab', {
      detail: {
        type: 'app-builder',
        title: t('toolCards.componentAuthoring.previewPanelTitle', { defaultValue: 'App Builder' }),
        data: {
          sessionId: sessionId ?? null,
          componentId: resolvedComponentId,
          componentKind: resolvedComponentKind,
          componentVersion: resolvedComponentVersion,
          componentPackageRoot: resolvedComponentPackageRoot,
          componentName: resolvedComponentName,
          componentDescription: resolvedComponentDescription,
          scope: appScope,
        },
        metadata: {
          appBuilderSessionId: sessionId,
          appBuilderComponentId: resolvedComponentId,
          appBuilderComponentKind: resolvedComponentKind,
          componentVersion: resolvedComponentVersion,
          componentPackageRoot: resolvedComponentPackageRoot,
          componentName: resolvedComponentName,
          componentDescription: resolvedComponentDescription,
          appScope,
          duplicateCheckKey,
        },
        checkDuplicate: true,
        duplicateCheckKey,
        replaceExisting: true,
      },
    }));
    // Notify any mounted App Builder workbench to refresh its component facts.
    window.dispatchEvent(new CustomEvent('component-updated', {
      detail: { componentId: resolvedComponentId, componentKind: resolvedComponentKind, scope: appScope },
    }));
  }, [
    appScope,
    resolvedComponentDescription,
    resolvedComponentId,
    resolvedComponentKind,
    resolvedComponentName,
    resolvedComponentPackageRoot,
    resolvedComponentVersion,
    sessionId,
    t,
  ]);

  const canOpenBuilderPanel =
    label.openable === true &&
    isCompleted &&
    !isFailed &&
    Boolean(resolvedComponentId && resolvedComponentKind);

  // Compact layout for read-only / introspection tools.
  if (label.layout === 'compact') {
    return (
      <DefaultToolCardTemplate
        toolId={toolItem.id ?? toolCall?.id}
        toolName={toolName}
        status={status}
        action={`${actionLabel}:`}
        summary={
          <span className="component-authoring-tool-info">
            <span className="operation-tag">{tagLabel}</span>
            <span className="command-text">{summary}</span>
          </span>
        }
        className="component-authoring-compact"
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
      className={`component-authoring-tool-display${canOpenBuilderPanel ? ' component-authoring-tool-display--panel-only' : ''}`}
      icon={label.icon}
      title={
        <span className="component-authoring-tool-info">
          <span className="operation-tag">{tagLabel}</span>
          <span className="command-text">{summary}</span>
          {chips.length > 0 ? (
            <span className="component-authoring-chip-row" aria-hidden>
              {chips.slice(0, 3).map((chip) => (
                <span className="component-authoring-chip" key={chip}>{chip}</span>
              ))}
            </span>
          ) : null}
        </span>
      }
      showHeaderExpandHint={!canOpenBuilderPanel && Boolean(expandedBody)}
      isRunning={isToolRunning}
      headerRail={canOpenBuilderPanel ? {
        label: t('toolCards.componentAuthoring.openBuilderPanel'),
        onClick: handleOpenBuilderPanel,
        icon: (
          <>
            <ChevronRight size={18} strokeWidth={2} absoluteStrokeWidth />
            <div className="task-status-icon task-status-icon--rail">
              {renderHeavyToolRunningStatus(isToolRunning)}
            </div>
          </>
        ),
      } : undefined}
      expandedContent={canOpenBuilderPanel ? undefined : expandedBody}
    />
  );
};
