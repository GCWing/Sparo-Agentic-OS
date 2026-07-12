import React, { useCallback, useMemo } from 'react';
import { Blocks, Plug, RotateCcw, Server, ShieldAlert } from 'lucide-react';
import { Button, IconButton, SparoSubagentIcon } from '@/design-system';
import { BUILTIN_TOOLS } from '@/app/scenes/tools/data/builtinTools';
import { useLastUsedWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import MCPAPI, { type MCPServerInfo } from '@/infrastructure/api/service-api/MCPAPI';
import { toolAPI } from '@/infrastructure/api/service-api/ToolAPI';
import { SubagentAPI, type SubagentInfo } from '@/infrastructure/api/service-api/SubagentAPI';
import {
  WorkspaceHubPreviewFrame,
  WorkspaceHubPreviewLoading,
  type WorkspaceHubPreviewTone,
} from './WorkspaceHubPreviewFrame';
import type { WorkspaceHubPreviewProps } from './workspaceHubPreviewTypes';
import { useHubPreviewResource } from './useHubPreviewResource';
import './CapabilitiesPreview.scss';

interface RegisteredTool {
  name: string;
}

function isConnected(server: MCPServerInfo): boolean {
  return /^(Connected|Healthy)$/i.test(server.status);
}

function needsAttention(server: MCPServerInfo): boolean {
  return /^(NeedsAuth|Failed)$/i.test(server.status);
}

function sourcePriority(item: SubagentInfo): number {
  if (item.subagentSource === 'project') return 0;
  if (item.subagentSource === 'user') return 1;
  return 2;
}

const CapabilitiesPreview: React.FC<WorkspaceHubPreviewProps> = ({
  label,
  primaryActionRef,
  onOpenScene,
}) => {
  const { t } = useI18n('common');
  const { workspacePath } = useLastUsedWorkspace();

  const serversResource = useHubPreviewResource<MCPServerInfo[]>(
    'workspace-hub:capabilities:mcp-servers',
    () => MCPAPI.getServers(),
  );
  const toolsResource = useHubPreviewResource<RegisteredTool[]>(
    'workspace-hub:capabilities:registered-tools',
    async () => toolAPI.getAllToolsInfo() as Promise<RegisteredTool[]>,
  );
  const subagentsResource = useHubPreviewResource<SubagentInfo[]>(
    `workspace-hub:capabilities:subagents:${workspacePath || 'global'}`,
    () => SubagentAPI.listSubagents({ workspacePath: workspacePath || undefined }),
  );

  const servers = serversResource.data ?? [];
  const connectedCount = servers.filter(isConnected).length;
  const attentionCount = servers.filter(needsAttention).length;
  const mcpToolCount = toolsResource.data
    ?.filter((tool) => tool.name.startsWith('mcp__')).length ?? null;
  const readySubagents = useMemo(
    () => [...(subagentsResource.data ?? [])]
      .filter((item) => item.enabled)
      .sort((left, right) => (
        sourcePriority(left) - sourcePriority(right) || left.name.localeCompare(right.name)
      ))
      .slice(0, 3),
    [subagentsResource.data],
  );

  const executionLoading = !serversResource.data
    && !toolsResource.data
    && (serversResource.loading || toolsResource.loading);
  const anyUnavailable = Boolean(
    serversResource.error || toolsResource.error || subagentsResource.error,
  );

  let statusKey = 'nav.menuPanel.hub.preview.capabilities.status.ready';
  let statusTone: WorkspaceHubPreviewTone = 'positive';
  if (executionLoading && subagentsResource.loading && !subagentsResource.data) {
    statusKey = 'nav.menuPanel.hub.preview.common.loading';
    statusTone = 'neutral';
  } else if (attentionCount > 0) {
    statusKey = 'nav.menuPanel.hub.preview.capabilities.status.attention';
    statusTone = 'danger';
  } else if (anyUnavailable) {
    statusKey = 'nav.menuPanel.hub.preview.capabilities.status.partial';
    statusTone = 'warning';
  } else if (!connectedCount && !readySubagents.length) {
    statusKey = 'nav.menuPanel.hub.preview.capabilities.status.idle';
    statusTone = 'neutral';
  }

  const openTools = useCallback(() => onOpenScene('tools'), [onOpenScene]);
  const openSubagents = useCallback(() => onOpenScene('subagents'), [onOpenScene]);
  const refreshServers = serversResource.refresh;
  const refreshTools = toolsResource.refresh;
  const refreshSubagents = subagentsResource.refresh;
  const refreshAll = useCallback(() => {
    refreshServers();
    refreshTools();
    refreshSubagents();
  }, [refreshServers, refreshSubagents, refreshTools]);

  const initialLoading = executionLoading
    && subagentsResource.loading
    && !subagentsResource.data;

  return (
    <WorkspaceHubPreviewFrame
      title={label}
      className="sparo-workspace-hub-capabilities-preview"
      headerMeta={(
        <div className="sparo-workspace-hub-capabilities-preview__header-actions">
          <IconButton
            variant="ghost"
            size="medium"
            shape="circle"
            aria-label={t('nav.menuPanel.hub.preview.capabilities.actions.subagents')}
            tooltip={t('nav.menuPanel.hub.preview.capabilities.actions.subagents')}
            tooltipPlacement="top"
            onClick={openSubagents}
          >
            <SparoSubagentIcon size={16} aria-hidden="true" />
          </IconButton>
          <IconButton
            ref={primaryActionRef}
            variant="brand"
            size="medium"
            shape="circle"
            aria-label={t('nav.menuPanel.hub.preview.capabilities.actions.tools')}
            tooltip={t('nav.menuPanel.hub.preview.capabilities.actions.tools')}
            tooltipPlacement="top"
            onClick={openTools}
          >
            <Blocks size={16} aria-hidden="true" />
          </IconButton>
        </div>
      )}
    >
      {initialLoading ? (
        <div className="sparo-workspace-hub-preview__wide">
          <WorkspaceHubPreviewLoading rows={3} />
        </div>
      ) : (
        <div className="sparo-workspace-hub-preview__wide sparo-workspace-hub-capabilities-preview__body">
          <div className="sparo-workspace-hub-capabilities-preview__map" role="list" aria-label={label}>
            <Button
              variant="ghost"
              size="small"
              className="sparo-workspace-hub-capabilities-preview__node is-builtin"
              role="listitem"
              onClick={openTools}
              aria-label={t('nav.menuPanel.hub.preview.capabilities.actions.tools')}
            >
              <span className="sparo-workspace-hub-capabilities-preview__node-icon" aria-hidden="true">
                <Blocks size={18} />
              </span>
              <strong>{BUILTIN_TOOLS.length}</strong>
              <span>{t('nav.menuPanel.hub.preview.capabilities.metrics.builtin')}</span>
            </Button>

            <span className="sparo-workspace-hub-capabilities-preview__connector" aria-hidden="true" />

            <Button
              variant="ghost"
              size="small"
              className={`sparo-workspace-hub-capabilities-preview__node${attentionCount ? ' is-danger' : connectedCount ? ' is-positive' : ''}`}
              role="listitem"
              onClick={openTools}
              aria-label={t('nav.menuPanel.hub.preview.capabilities.actions.tools')}
            >
              <span className="sparo-workspace-hub-capabilities-preview__node-icon" aria-hidden="true">
                {attentionCount ? <ShieldAlert size={18} /> : <Server size={18} />}
              </span>
              <strong>{serversResource.data ? connectedCount : '—'}</strong>
              <span>{t('nav.menuPanel.hub.preview.capabilities.metrics.connected')}</span>
              <small>
                {serversResource.data
                  ? t('nav.menuPanel.hub.preview.capabilities.meta.servers', { count: servers.length })
                  : t('nav.menuPanel.hub.preview.common.statusUnavailable')}
              </small>
            </Button>

            <span className="sparo-workspace-hub-capabilities-preview__connector" aria-hidden="true" />

            <Button
              variant="ghost"
              size="small"
              className={`sparo-workspace-hub-capabilities-preview__node${readySubagents.length ? ' is-accent' : ''}`}
              role="listitem"
              onClick={openSubagents}
              aria-label={t('nav.menuPanel.hub.preview.capabilities.actions.subagents')}
            >
              <span className="sparo-workspace-hub-capabilities-preview__node-icon" aria-hidden="true">
                <SparoSubagentIcon size={18} />
              </span>
              <strong>{subagentsResource.data ? readySubagents.length : '—'}</strong>
              <span>{t('nav.menuPanel.hub.preview.capabilities.metrics.specialists')}</span>
            </Button>
          </div>

          <section className="sparo-workspace-hub-capabilities-preview__specialists">
            <h3>{t('nav.menuPanel.hub.preview.capabilities.sections.specialists')}</h3>
            {readySubagents.length > 0 ? (
              <div className="sparo-workspace-hub-capabilities-preview__specialist-strip">
                {readySubagents.map((subagent) => (
                  <Button
                    key={subagent.id}
                    variant="ghost"
                    size="small"
                    shape="pill"
                    title={subagent.description || subagent.model}
                    onClick={openSubagents}
                  >
                    <SparoSubagentIcon size={13} aria-hidden="true" />
                    <span>{subagent.name}</span>
                  </Button>
                ))}
              </div>
            ) : (
              <span className="sparo-workspace-hub-capabilities-preview__specialist-empty">
                {subagentsResource.data?.length
                  ? t('nav.menuPanel.hub.preview.capabilities.empty.noneEnabledTitle')
                  : t('nav.menuPanel.hub.preview.capabilities.empty.noneTitle')}
              </span>
            )}
          </section>

          <div className="sparo-workspace-hub-capabilities-preview__pulse">
            <span className={`is-${statusTone}`}>
              <span aria-hidden="true" />
              {t(statusKey)}
            </span>
            {mcpToolCount !== null && (
              <span>
                <Plug size={12} aria-hidden="true" />
                {mcpToolCount} {t('nav.menuPanel.hub.preview.capabilities.execution.mcpTools')}
              </span>
            )}
            {anyUnavailable && (
              <Button variant="ghost" size="small" onClick={refreshAll}>
                <RotateCcw size={12} aria-hidden="true" />
                {t('nav.menuPanel.hub.preview.common.retry')}
              </Button>
            )}
          </div>
        </div>
      )}
    </WorkspaceHubPreviewFrame>
  );
};

export default CapabilitiesPreview;
