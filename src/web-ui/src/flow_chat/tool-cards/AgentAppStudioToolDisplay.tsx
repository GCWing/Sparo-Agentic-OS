import React, { useCallback, useMemo, useState } from 'react';
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  FileCode2,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  TestTube,
  Wrench,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ToolCardProps } from '../types/flow-chat';
import { BaseToolCard, ToolCardHeader } from './BaseToolCard';
import { CompactToolCard, CompactToolCardHeader } from './CompactToolCard';
import './AgentAppStudioToolDisplay.scss';

const EMPTY_TOOL_RESULT: Record<string, unknown> = {};

interface ToolLabelEntry {
  icon: React.ReactNode;
  tagKey: string;
  layout: 'compact' | 'standard';
  /** Whether to show the "open in Apps" affordance (mutating apps tools). */
  openable?: boolean;
}

const TOOL_LABELS: Record<string, ToolLabelEntry> = {
  ListAgentApps: {
    icon: <ListChecks size={16} />,
    tagKey: 'list',
    layout: 'compact',
  },
  GetAgentApp: {
    icon: <Search size={16} />,
    tagKey: 'inspect',
    layout: 'compact',
  },
  ValidateAgentAppPackage: {
    icon: <ShieldCheck size={16} />,
    tagKey: 'validate',
    layout: 'compact',
  },
  CreateAgentApp: {
    icon: <Plus size={16} />,
    tagKey: 'create',
    layout: 'standard',
    openable: true,
  },
  UpdateAgentApp: {
    icon: <Pencil size={16} />,
    tagKey: 'update',
    layout: 'standard',
    openable: true,
  },
  ListAgentAppToolOptions: {
    icon: <Wrench size={16} />,
    tagKey: 'tools',
    layout: 'compact',
  },
  CreateAgentAppJsTool: {
    icon: <FileCode2 size={16} />,
    tagKey: 'jsTool',
    layout: 'standard',
  },
  TestAgentAppJsTool: {
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

export const AgentAppStudioToolDisplay: React.FC<ToolCardProps> = ({ toolItem, sessionId }) => {
  const { t } = useTranslation('flow-chat');
  const { status, toolResult, toolCall, partialParams, isParamsStreaming } = toolItem;
  const [isExpanded, setIsExpanded] = useState(false);
  const toolName = toolItem.toolName;
  const label = TOOL_LABELS[toolName] ?? {
    icon: <Bot size={16} />,
    tagKey: 'generic',
    layout: 'compact',
  };

  const result = (toolResult?.result ?? EMPTY_TOOL_RESULT) as Record<string, unknown>;
  const input = (isParamsStreaming ? partialParams : toolCall?.input) as Record<string, unknown> | undefined;
  const isFailed =
    status === 'error' || (status === 'completed' && toolResult != null && toolResult.success === false);

  const actionLabel = t('toolCards.agentAppStudio.title');
  const tagLabel = t(`toolCards.agentAppStudio.${label.tagKey}`, { defaultValue: toolName });

  const statusIcon = useMemo(() => {
    if (status === 'completed') return <Check size={14} />;
    if (status === 'error' || status === 'cancelled') return <X size={14} />;
    if (
      status === 'running' ||
      status === 'preparing' ||
      status === 'streaming' ||
      status === 'receiving' ||
      status === 'analyzing'
    ) {
      return <Loader2 size={14} className="agent-app-studio-tool-spin" />;
    }
    return <Clock size={14} />;
  }, [status]);

  // Build summary text per tool.
  const summary = useMemo(() => {
    if (toolName === 'ListAgentApps') {
      const apps = Array.isArray(result.apps) ? result.apps : [];
      if (status !== 'completed') return t('toolCards.agentAppStudio.scanning');
      return t('toolCards.agentAppStudio.appsCount', { count: apps.length });
    }
    if (toolName === 'GetAgentApp') {
      const manifest = pickManifest(result);
      const name = (manifest?.name as string | undefined) ?? (input?.id as string | undefined);
      return name ?? t('toolCards.agentAppStudio.loading');
    }
    if (toolName === 'ValidateAgentAppPackage') {
      if (status !== 'completed') return t('toolCards.agentAppStudio.validating');
      const ok = result.ok !== false;
      return ok ? t('toolCards.agentAppStudio.validOk') : t('toolCards.agentAppStudio.validFailed');
    }
    if (toolName === 'CreateAgentApp' || toolName === 'UpdateAgentApp') {
      const manifest = pickManifest(result);
      const name = (manifest?.name as string | undefined) ?? (input?.name as string | undefined);
      const tools = Array.isArray(manifest?.tools)
        ? (manifest!.tools as unknown[]).length
        : Array.isArray(input?.tools)
          ? (input!.tools as unknown[]).length
          : undefined;
      const base = name || t('toolCards.agentAppStudio.unnamed');
      return tools !== undefined
        ? `${base} · ${t('toolCards.agentAppStudio.toolsCount', { count: tools })}`
        : base;
    }
    if (toolName === 'ListAgentAppToolOptions') {
      const tools = Array.isArray(result.tools) ? (result.tools as unknown[]).length : 0;
      if (status !== 'completed') return t('toolCards.agentAppStudio.scanning');
      return t('toolCards.agentAppStudio.toolsCount', { count: tools });
    }
    if (toolName === 'CreateAgentAppJsTool') {
      const created = (result.toolName as string | undefined) ?? (input?.appId as string | undefined);
      return created ?? t('toolCards.agentAppStudio.creatingJsTool');
    }
    if (toolName === 'TestAgentAppJsTool') {
      const tested = (input?.toolName as string | undefined) ?? '';
      if (status !== 'completed') {
        return tested
          ? t('toolCards.agentAppStudio.testingNamed', { name: tested })
          : t('toolCards.agentAppStudio.testing');
      }
      const ok = result.success !== false;
      return tested
        ? `${tested} · ${ok ? t('toolCards.agentAppStudio.testPass') : t('toolCards.agentAppStudio.testFail')}`
        : ok
          ? t('toolCards.agentAppStudio.testPass')
          : t('toolCards.agentAppStudio.testFail');
    }
    return toolName;
  }, [toolName, result, input, status, t]);

  // Chips: small structured tags shown next to the summary in expanded/standard mode.
  const chips = useMemo<string[]>(() => {
    const out: string[] = [];
    if (toolName === 'CreateAgentApp' || toolName === 'UpdateAgentApp' || toolName === 'GetAgentApp') {
      const manifest = pickManifest(result) ?? input ?? {};
      const id = describeChip('id', manifest.id as string | undefined);
      const model = describeChip(
        t('toolCards.agentAppStudio.fieldModel'),
        manifest.model as string | undefined,
      );
      const cat = describeChip(
        t('toolCards.agentAppStudio.fieldCategory'),
        manifest.category as string | undefined,
      );
      const ro = manifest.readonly === true ? t('toolCards.agentAppStudio.readonly') : null;
      [id, model, cat, ro].forEach((chip) => {
        if (chip) out.push(chip);
      });
    }
    if (toolName === 'CreateAgentAppJsTool') {
      const appId = describeChip('appId', input?.appId as string | undefined);
      if (appId) out.push(appId);
    }
    return out;
  }, [toolName, result, input, t]);

  // Expanded body: detailed list / per-tool layouts.
  const expandedBody = useMemo<React.ReactNode>(() => {
    if (toolName === 'ListAgentApps') {
      const apps = Array.isArray(result.apps) ? (result.apps as AppRow[]) : [];
      if (apps.length === 0) return null;
      return (
        <div className="agent-app-studio-list-details">
          {apps.slice(0, 24).map((app, idx) => (
            <div className="agent-app-studio-app-row" key={`${app.id ?? idx}`}>
              <span className="name" title={app.name ?? app.id}>{app.name ?? app.id ?? '—'}</span>
              <span className="desc" title={app.description ?? ''}>{app.description ?? ''}</span>
              <span className="id" title={app.id ?? ''}>{app.id ?? ''}</span>
            </div>
          ))}
          {apps.length > 24 ? (
            <div className="agent-app-studio-tool-row">
              <span className="agent-app-studio-tool-label">…</span>
              <span className="agent-app-studio-tool-value">
                {t('toolCards.agentAppStudio.moreApps', { count: apps.length - 24 })}
              </span>
            </div>
          ) : null}
        </div>
      );
    }
    if (toolName === 'ListAgentAppToolOptions') {
      const tools = Array.isArray(result.tools) ? (result.tools as string[]) : [];
      if (tools.length === 0) return null;
      return (
        <div className="agent-app-studio-tools-details">
          <div className="agent-app-studio-chip-row">
            {tools.slice(0, 80).map((tool) => (
              <span className="agent-app-studio-chip" key={tool}>{tool}</span>
            ))}
          </div>
          {tools.length > 80 ? (
            <div className="agent-app-studio-tool-row">
              <span className="agent-app-studio-tool-label">…</span>
              <span className="agent-app-studio-tool-value">
                {t('toolCards.agentAppStudio.moreTools', { count: tools.length - 80 })}
              </span>
            </div>
          ) : null}
        </div>
      );
    }
    if (
      toolName === 'GetAgentApp' ||
      toolName === 'CreateAgentApp' ||
      toolName === 'UpdateAgentApp' ||
      toolName === 'ValidateAgentAppPackage'
    ) {
      const manifest = pickManifest(result);
      if (!manifest) return null;
      const tools = Array.isArray(manifest.tools) ? (manifest.tools as string[]) : [];
      const tags = Array.isArray(manifest.tags) ? (manifest.tags as string[]) : [];
      const examples = Array.isArray(manifest.examples) ? (manifest.examples as unknown[]).length : 0;
      const rows: Array<[string, React.ReactNode]> = [];
      if (manifest.name) rows.push([t('toolCards.agentAppStudio.fieldName'), String(manifest.name)]);
      if (manifest.id) rows.push(['id', String(manifest.id)]);
      if (manifest.description)
        rows.push([t('toolCards.agentAppStudio.fieldDescription'), String(manifest.description)]);
      if (manifest.model)
        rows.push([t('toolCards.agentAppStudio.fieldModel'), String(manifest.model)]);
      if (manifest.category)
        rows.push([t('toolCards.agentAppStudio.fieldCategory'), String(manifest.category)]);
      rows.push([
        t('toolCards.agentAppStudio.fieldReadonly'),
        manifest.readonly === true ? 'true' : 'false',
      ]);
      if (tools.length) {
        rows.push([
          t('toolCards.agentAppStudio.fieldTools'),
          <span className="agent-app-studio-chip-row" key="tools-row">
            {tools.slice(0, 20).map((tool) => (
              <span className="agent-app-studio-chip" key={tool}>{tool}</span>
            ))}
            {tools.length > 20 ? (
              <span className="agent-app-studio-chip">+{tools.length - 20}</span>
            ) : null}
          </span>,
        ]);
      }
      if (tags.length) {
        rows.push([
          t('toolCards.agentAppStudio.fieldTags'),
          <span className="agent-app-studio-chip-row" key="tags-row">
            {tags.map((tag) => (
              <span className="agent-app-studio-chip" key={tag}>{tag}</span>
            ))}
          </span>,
        ]);
      }
      if (examples) {
        rows.push([t('toolCards.agentAppStudio.fieldExamples'), `${examples}`]);
      }
      if (typeof result.path === 'string') {
        rows.push([t('toolCards.agentAppStudio.fieldPath'), result.path]);
      }
      if (rows.length === 0) return null;
      return (
        <div className="agent-app-studio-tool-details">
          {rows.map(([k, v]) => (
            <div key={k} className="agent-app-studio-tool-row">
              <span className="agent-app-studio-tool-label">{k}</span>
              <span className="agent-app-studio-tool-value">{v}</span>
            </div>
          ))}
        </div>
      );
    }
    if (toolName === 'CreateAgentAppJsTool') {
      const rows: Array<[string, string]> = [];
      const created = (result.toolName as string | undefined) ?? '';
      if (created) rows.push([t('toolCards.agentAppStudio.fieldToolName'), created]);
      if (input?.appId) rows.push(['appId', String(input.appId)]);
      const manifest = asRecord(input?.manifest);
      if (manifest?.description)
        rows.push([t('toolCards.agentAppStudio.fieldDescription'), String(manifest.description)]);
      if (typeof manifest?.timeoutMs === 'number')
        rows.push(['timeoutMs', String(manifest.timeoutMs)]);
      if (manifest?.readonly !== undefined)
        rows.push([t('toolCards.agentAppStudio.fieldReadonly'), String(manifest.readonly)]);
      if (rows.length === 0) return null;
      return (
        <div className="agent-app-studio-tool-details">
          {rows.map(([k, v]) => (
            <div key={k} className="agent-app-studio-tool-row">
              <span className="agent-app-studio-tool-label">{k}</span>
              <span className="agent-app-studio-tool-value">{v}</span>
            </div>
          ))}
        </div>
      );
    }
    if (toolName === 'TestAgentAppJsTool') {
      const rows: Array<[string, string]> = [];
      if (input?.toolName) rows.push([t('toolCards.agentAppStudio.fieldToolName'), String(input.toolName)]);
      if (input?.appId) rows.push(['appId', String(input.appId)]);
      const summaryStr = (result.summary as string | undefined) ?? '';
      if (summaryStr) rows.push([t('toolCards.agentAppStudio.fieldSummary'), summaryStr]);
      const data = result.data;
      if (data !== undefined && data !== null) {
        rows.push(['data', typeof data === 'string' ? data : JSON.stringify(data)]);
      }
      if (rows.length === 0) return null;
      return (
        <div className="agent-app-studio-tool-details">
          {rows.map(([k, v]) => (
            <div key={k} className="agent-app-studio-tool-row">
              <span className="agent-app-studio-tool-label">{k}</span>
              <span className="agent-app-studio-tool-value">{v}</span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  }, [toolName, result, input, t]);

  const hasExpandable = expandedBody != null;

  const handleCardClick = useCallback(() => {
    if (!hasExpandable) return;
    setIsExpanded((value) => !value);
  }, [hasExpandable]);

  // Resolve the app id this tool produced/touched, so we can drive the
  // right-side AgentAppStudio preview panel.
  const resolvedAppId = useMemo<string | undefined>(() => {
    const manifest = pickManifest(result);
    return (
      (manifest?.id as string | undefined) ??
      (result.id as string | undefined) ??
      (input?.id as string | undefined) ??
      (input?.appId as string | undefined) ??
      (input?.name as string | undefined)
    );
  }, [result, input]);

  const handleOpenStudioPanel = useCallback(() => {
    if (!resolvedAppId) return;
    const duplicateCheckKey = `agent-app-studio:${sessionId ?? resolvedAppId}`;
    window.dispatchEvent(new CustomEvent('expand-right-panel'));
    window.dispatchEvent(new CustomEvent('agent-create-tab', {
      detail: {
        type: 'agent-app-studio',
        title: t('toolCards.agentAppStudio.previewPanelTitle', { defaultValue: 'Agent App Studio' }),
        data: {
          sessionId: sessionId ?? null,
          appId: resolvedAppId,
        },
        metadata: {
          agentAppStudioSessionId: sessionId,
          agentAppStudioAppId: resolvedAppId,
        },
        checkDuplicate: true,
        duplicateCheckKey,
        replaceExisting: true,
      },
    }));
    // Notify any mounted AgentAppStudioPanel to refresh / switch app.
    window.dispatchEvent(new CustomEvent('agent-app-updated', {
      detail: { appId: resolvedAppId },
    }));
  }, [resolvedAppId, sessionId, t]);

  const canOpenStudioPanel =
    label.openable === true &&
    status === 'completed' &&
    !isFailed &&
    Boolean(resolvedAppId);

  // Compact layout for read-only / introspection tools.
  if (label.layout === 'compact') {
    return (
      <CompactToolCard
        status={status}
        isExpanded={isExpanded && hasExpandable}
        className="agent-app-studio-compact"
        clickable={hasExpandable}
        onClick={hasExpandable ? handleCardClick : undefined}
        expandedContent={expandedBody}
        header={
          <CompactToolCardHeader
            statusIcon={statusIcon}
            action={`${actionLabel}:`}
            content={
              <span className="agent-app-studio-tool-info">
                <span className="operation-tag">{tagLabel}</span>
                <span className="command-text">{summary}</span>
              </span>
            }
            rightIcon={hasExpandable ? <ChevronDown size={13} /> : undefined}
          />
        }
      />
    );
  }

  // Standard layout for mutating / package-producing tools.
  return (
    <BaseToolCard
      status={status}
      isFailed={isFailed}
      isExpanded={isExpanded}
      onClick={hasExpandable ? handleCardClick : undefined}
      headerExpandAffordance={hasExpandable}
      headerAffordanceKind="expand"
      className={`agent-app-studio-tool-display${canOpenStudioPanel ? ' is-openable' : ''}`}
      header={
        <ToolCardHeader
          icon={label.icon}
          iconClassName="agent-app-studio-tool-icon"
          action={`${actionLabel}:`}
          content={
            <span className="agent-app-studio-tool-info">
              <span className="operation-tag">{tagLabel}</span>
              <span className="command-text">{summary}</span>
              {chips.length > 0 ? (
                <span className="agent-app-studio-chip-row" aria-hidden>
                  {chips.slice(0, 3).map((chip) => (
                    <span className="agent-app-studio-chip" key={chip}>{chip}</span>
                  ))}
                </span>
              ) : null}
            </span>
          }
          extra={
            canOpenStudioPanel ? (
              <div className="agent-app-studio-tool-extras">
                <div className="agent-app-studio-debug-rail">
                  <button
                    type="button"
                    className="agent-app-studio-debug-rail__hit"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenStudioPanel();
                    }}
                    aria-label={t('toolCards.agentAppStudio.openStudioPanel')}
                    title={t('toolCards.agentAppStudio.openStudioPanel')}
                  />
                  <div className="agent-app-studio-debug-rail__visual" aria-hidden>
                    <ChevronRight size={18} strokeWidth={2} absoluteStrokeWidth />
                  </div>
                </div>
              </div>
            ) : undefined
          }
        />
      }
      expandedContent={expandedBody}
    />
  );
};
