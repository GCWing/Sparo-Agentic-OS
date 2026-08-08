import React, { useCallback } from 'react';
import { ChevronRight, RotateCcw } from 'lucide-react';
import {
  Button,
  SkillsIcon,
  SPARO_ICON_OPTICAL_STROKE_WIDTH,
  SparoSubagentIcon,
  ToolsIcon,
} from '@/design-system';
import { configAPI } from '@/infrastructure/api';
import { SubagentAPI, type SubagentInfo } from '@/infrastructure/api/service-api/SubagentAPI';
import { toolAPI } from '@/infrastructure/api/service-api/ToolAPI';
import type { SkillCatalog } from '@/infrastructure/config/types';
import { useLastUsedWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import {
  WorkspaceHubPreviewFrame,
  WorkspaceHubPreviewLoading,
} from './WorkspaceHubPreviewFrame';
import type { WorkspaceHubPreviewProps } from './workspaceHubPreviewTypes';
import { useHubPreviewResource } from './useHubPreviewResource';
import './CapabilitiesPreview.scss';

interface RegisteredTool {
  name: string;
}

const CapabilitiesPreview: React.FC<WorkspaceHubPreviewProps> = ({
  label,
  primaryActionRef,
  onOpenItem,
}) => {
  const { t } = useI18n('common');
  const { workspacePath } = useLastUsedWorkspace();

  const skillsResource = useHubPreviewResource<SkillCatalog>(
    `workspace-hub:capabilities:skills:${workspacePath || 'global'}`,
    () => configAPI.getSkillConfigs({ workspacePath: workspacePath || undefined }),
  );
  const toolsResource = useHubPreviewResource<RegisteredTool[]>(
    'workspace-hub:capabilities:registered-tools',
    async () => toolAPI.getAllToolsInfo() as Promise<RegisteredTool[]>,
  );
  const subagentsResource = useHubPreviewResource<SubagentInfo[]>(
    `workspace-hub:capabilities:subagents:${workspacePath || 'global'}`,
    () => SubagentAPI.listSubagents({ workspacePath: workspacePath || undefined }),
  );

  const mcpToolCount = toolsResource.data
    ?.filter((tool) => tool.name.startsWith('mcp__')).length ?? null;
  const enabledSubagentCount = subagentsResource.data
    ?.filter((subagent) => subagent.enabled).length ?? null;
  const initialLoading = !skillsResource.data
    && !toolsResource.data
    && !subagentsResource.data
    && skillsResource.loading
    && toolsResource.loading
    && subagentsResource.loading;
  const anyUnavailable = Boolean(
    skillsResource.error || toolsResource.error || subagentsResource.error,
  );

  const refreshSkills = skillsResource.refresh;
  const refreshTools = toolsResource.refresh;
  const refreshSubagents = subagentsResource.refresh;
  const refreshAll = useCallback(() => {
    refreshSkills();
    refreshTools();
    refreshSubagents();
  }, [refreshSkills, refreshSubagents, refreshTools]);

  return (
    <WorkspaceHubPreviewFrame
      title={label}
      className="sparo-workspace-hub-capabilities-preview"
    >
      {initialLoading ? (
        <div className="sparo-workspace-hub-preview__wide">
          <WorkspaceHubPreviewLoading rows={3} />
        </div>
      ) : (
        <div className="sparo-workspace-hub-preview__wide sparo-workspace-hub-capabilities-preview__body">
          <ul className="sparo-workspace-hub-capabilities-preview__stats">
            <li>
              <Button
                ref={primaryActionRef}
                variant="ghost"
                size="small"
                className="sparo-workspace-hub-capabilities-preview__stat"
                aria-label={t('nav.menuPanel.hub.preview.capabilities.actions.skills')}
                onClick={() => onOpenItem('skills')}
              >
                <span className="sparo-workspace-hub-capabilities-preview__stat-icon" aria-hidden="true">
                  <SkillsIcon
                    size={20}
                    strokeWidth={SPARO_ICON_OPTICAL_STROKE_WIDTH.compact}
                    absoluteStrokeWidth
                  />
                </span>
                <span className="sparo-workspace-hub-capabilities-preview__stat-copy">
                  <strong>{t('nav.menuPanel.hub.preview.capabilities.metrics.skills')}</strong>
                  <small>
                    {skillsResource.data
                      ? t('nav.menuPanel.hub.preview.capabilities.meta.suites', {
                        count: skillsResource.data.suites.length,
                      })
                      : t('nav.menuPanel.hub.preview.common.statusUnavailable')}
                  </small>
                </span>
                <span className="sparo-workspace-hub-capabilities-preview__stat-value">
                  {skillsResource.data ? skillsResource.data.skills.length : '—'}
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </Button>
            </li>

            <li>
              <Button
                variant="ghost"
                size="small"
                className="sparo-workspace-hub-capabilities-preview__stat"
                aria-label={t('nav.menuPanel.hub.preview.capabilities.actions.tools')}
                onClick={() => onOpenItem('tools')}
              >
                <span className="sparo-workspace-hub-capabilities-preview__stat-icon" aria-hidden="true">
                  <ToolsIcon
                    size={20}
                    strokeWidth={SPARO_ICON_OPTICAL_STROKE_WIDTH.compact}
                    absoluteStrokeWidth
                  />
                </span>
                <span className="sparo-workspace-hub-capabilities-preview__stat-copy">
                  <strong>{t('nav.menuPanel.hub.preview.capabilities.metrics.tools')}</strong>
                  <small>
                    {mcpToolCount !== null
                      ? t('nav.menuPanel.hub.preview.capabilities.meta.mcpTools', {
                        count: mcpToolCount,
                      })
                      : t('nav.menuPanel.hub.preview.common.statusUnavailable')}
                  </small>
                </span>
                <span className="sparo-workspace-hub-capabilities-preview__stat-value">
                  {toolsResource.data ? toolsResource.data.length : '—'}
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </Button>
            </li>

            <li>
              <Button
                variant="ghost"
                size="small"
                className="sparo-workspace-hub-capabilities-preview__stat"
                aria-label={t('nav.menuPanel.hub.preview.capabilities.actions.subagents')}
                onClick={() => onOpenItem('subagents')}
              >
                <span className="sparo-workspace-hub-capabilities-preview__stat-icon" aria-hidden="true">
                  <SparoSubagentIcon
                    size={20}
                    strokeWidth={SPARO_ICON_OPTICAL_STROKE_WIDTH.compact}
                    absoluteStrokeWidth
                  />
                </span>
                <span className="sparo-workspace-hub-capabilities-preview__stat-copy">
                  <strong>{t('nav.menuPanel.hub.preview.capabilities.metrics.subagents')}</strong>
                  <small>
                    {subagentsResource.data
                      ? t('nav.menuPanel.hub.preview.capabilities.meta.enabledOf', {
                        enabled: enabledSubagentCount,
                        count: subagentsResource.data.length,
                      })
                      : t('nav.menuPanel.hub.preview.common.statusUnavailable')}
                  </small>
                </span>
                <span className="sparo-workspace-hub-capabilities-preview__stat-value">
                  {enabledSubagentCount ?? '—'}
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </Button>
            </li>
          </ul>

          {anyUnavailable && (
            <div className="sparo-workspace-hub-capabilities-preview__status" role="status">
              <span>{t('nav.menuPanel.hub.preview.capabilities.status.partial')}</span>
              <Button variant="ghost" size="small" onClick={refreshAll}>
                <RotateCcw size={13} aria-hidden="true" />
                {t('nav.menuPanel.hub.preview.common.retry')}
              </Button>
            </div>
          )}
        </div>
      )}
    </WorkspaceHubPreviewFrame>
  );
};

export default CapabilitiesPreview;
